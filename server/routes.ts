import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateToken, hashPassword, comparePassword, requireAuth, requireRole } from "./auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import mime from "mime-types";
import { KokoroTTS } from "kokoro-js";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

let activeConversions = 0;
const MAX_CONCURRENT_CONVERSIONS = 3;

let kokoroTTS: any = null;
let kokoroLoading = false;
let kokoroReady = false;

export async function getKokoroTTS() {
  if (kokoroReady && kokoroTTS) return kokoroTTS;
  if (kokoroLoading) {
    // Wait for existing load
    while (kokoroLoading) {
      await new Promise(r => setTimeout(r, 200));
    }
    return kokoroTTS;
  }
  kokoroLoading = true;
  try {
    console.log("[Kokoro] Loading TTS model (first time may take 30s)...");
    kokoroTTS = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      { dtype: "q8", device: "cpu" }
    );
    kokoroReady = true;
    console.log("[Kokoro] TTS model ready \u2713");
    return kokoroTTS;
  } catch (err) {
    console.error("[Kokoro] Failed to load TTS model:", err);
    kokoroLoading = false;
    throw err;
  } finally {
    kokoroLoading = false;
  }
}

function sanitizeUser(user: any) {
  const { passwordHash, ...rest } = user;
  return rest;
}

async function patchAvailableFormats(
  contentId: string,
  formatKey: string,
  filePath: string,
  status: string
) {
  try {
    const item = await storage.getContentItem(contentId);
    if (!item) return;
    const existing = (item.availableFormats as Record<string, any>) || {};
    const updated = {
      ...existing,
      [formatKey]: { path: filePath, status }
    };
    await storage.updateContentItem(contentId, { availableFormats: updated });
  } catch (e) {
    console.error(`[patchAvailableFormats] Failed for ${contentId}/${formatKey}:`, e);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", services: { db: "connected", storage: "local" } });
  });

  app.get('/api/content/file/uploads/converted/:contentId/:filename',
    requireAuth,
    (req: Request, res: Response) => {
      const { contentId, filename } = req.params as { contentId: string, filename: string };

      // Security: validate contentId is a UUID and filename has no path traversal
      const uuidRegex = /^[0-9a-f-]{36}$/i;
      const safeFilename = /^[a-zA-Z0-9._-]+$/;

      if (!uuidRegex.test(contentId) || !safeFilename.test(filename)) {
        return res.status(400).json({ error: 'Invalid file path' });
      }

      const relativePath = `uploads/converted/${contentId}/${filename}`;
      const filePath = path.join(process.cwd(), relativePath);

      // Local fallback for dev/cache
      if (fs.existsSync(filePath)) {
        const mimeType = mime.lookup(filename) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.sendFile(filePath);
      }

      // Cloud Fallback for Production (Railway)
      (async () => {
        try {
          const { isAzureConfigured, downloadBuffer } = await import('./services/blobStorage');
          if (isAzureConfigured()) {
            const blobPath = `converted/${contentId}/${filename}`;
            console.log(`[FileServe] Fetching from Azure: ${blobPath}`);
            const buffer = await downloadBuffer(blobPath);
            if (buffer) {
              const mimeType = mime.lookup(filename) || 'application/octet-stream';
              res.setHeader('Content-Type', mimeType);
              return res.send(buffer);
            }
          }
          console.error('[FileServe] File not found local or cloud:', relativePath);
          return res.status(404).json({ error: 'File not found' });
        } catch (err) {
          console.error('[FileServe] Cloud fallback error:', err);
          return res.status(500).json({ error: 'Error retrieving file' });
        }
      })();
    }
  );

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, role } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, password, and name are required" });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        email,
        passwordHash,
        name,
        role: role || "student",
      });

      const token = generateToken({ userId: user.id, email: user.email, role: user.role });
      res.status(201).json({ user: sanitizeUser(user), token });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const valid = await comparePassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      await storage.updateUser(user.id, { lastLoginAt: new Date() });
      const token = generateToken({ userId: user.id, email: user.email, role: user.role });
      res.json({ user: sanitizeUser(user), token });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
    res.json({ message: "Logged out successfully" });
  });

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const { role, search, status } = req.query;
      const userList = await storage.listUsers({
        role: role as string,
        search: search as string,
        status: status as string,
      });
      res.json(userList.map(sanitizeUser));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/users/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.params.id as string);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/users/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.updateUser(req.params.id as string, req.body);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/users/:id/accessibility-profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const { disabilities, preferences, activeModules } = req.body;
      const user = await storage.updateUser(req.params.id as string, {
        disabilities,
        preferences,
        activeModules,
        profileCompleted: true,
        profileSetupCompletedAt: new Date(),
      });
      if (!user) return res.status(404).json({ message: "User not found" });

      await storage.createAuditLog({
        actorId: req.user!.userId,
        actorRole: req.user!.role,
        action: "UPDATE_ACCESSIBILITY_PROFILE",
        targetId: req.params.id as string,
        targetType: "user",
        ipAddress: req.ip,
      });

      res.json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/me/accessibility-profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      await storage.createAuditLog({
        actorId: req.user!.userId,
        actorRole: req.user!.role,
        action: "READ_ACCESSIBILITY_PROFILE",
        targetId: user.id,
        targetType: "user",
        ipAddress: req.ip,
      });

      res.json({
        disabilities: user.disabilities,
        preferences: user.preferences,
        activeModules: user.activeModules,
        profileCompleted: user.profileCompleted,
        profileSetupCompletedAt: user.profileSetupCompletedAt,
        firstLoginRequired: !user.profileCompleted,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { email, password, name, role, program, year, division, disabilities, preferences } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ message: "Email, password, and name are required" });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        email,
        passwordHash,
        name,
        role: role || "student",
        program,
        year,
        division,
        disabilities: disabilities || [],
        preferences: preferences || { fontSize: 1.0, ttsSpeed: 1.0, extendedTimeMultiplier: 1.0, contrastMode: false },
      });

      res.status(201).json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users/:id/deactivate", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const user = await storage.updateUser(id, { status: "inactive" });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users/:id/activate", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const user = await storage.updateUser(id, { status: "active" });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users/:id/reset-password", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const newPassword = req.body.password || "TempPass123!";
      const passwordHash = await hashPassword(newPassword);
      const user = await storage.updateUser(id, { passwordHash });
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ message: "Password reset successful" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/institutes", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const inst = await storage.createInstitute(req.body);
      res.status(201).json(inst);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/institutes", requireAuth, async (_req: Request, res: Response) => {
    try {
      const list = await storage.listInstitutes();
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/institutes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const inst = await storage.getInstitute(req.params.id as string);
      if (!inst) return res.status(404).json({ message: "Institute not found" });
      res.json(inst);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/institutes/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const inst = await storage.updateInstitute(id, req.body);
      if (!inst) return res.status(404).json({ message: "Institute not found" });
      res.json(inst);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── ADMIN USER MANAGEMENT ───────────────────────────────────────────────────
  app.get("/api/admin/users", requireAuth, requireRole("admin"), async (_req: Request, res: Response) => {
    try {
      const list = await storage.listUsers();
      res.json(list.map(sanitizeUser));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/users", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { name, email, password, role, program, year, division } = req.body;
      if (!name || !email || !role) {
        return res.status(400).json({ message: "Name, email, and role are required" });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "A user with this email already exists" });
      }
      const pw = password || (Math.random().toString(36).slice(-10) + "A1!");
      const passwordHash = await hashPassword(pw);
      const user = await storage.createUser({
        name,
        email: email.toLowerCase(),
        role,
        passwordHash,
        status: "active",
        instituteId: req.user?.instituteId ?? null,
        program: program || null,
        year: year ? parseInt(year) : null,
        division: division || null,
      } as any);
      res.status(201).json(sanitizeUser(user));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── COURSE OFFERINGS ─────────────────────────────────────────────────────────
  app.get("/api/course-offerings", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseId, termId, instituteId } = req.query;
      const list = await storage.listCourseOfferings({
        courseId: courseId as string,
        termId: termId as string,
        instituteId: instituteId as string,
      });
      // Enrich with course data
      const enriched = await Promise.all(
        list.map(async (co: any) => {
          const course = await storage.getCourse(co.courseId);
          return { ...co, course };
        })
      );
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/course-offerings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const co = await storage.getCourseOffering(id);
      if (!co) return res.status(404).json({ message: "Course offering not found" });
      const course = await storage.getCourse(co.courseId);
      // Get teachers assigned to this offering
      const allUsers = await storage.listUsers();
      const teachers = allUsers.filter((u: any) => u.role === "teacher");
      res.json({ ...co, course, teachers });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── ENROLLMENTS ──────────────────────────────────────────────────────────────
  app.get("/api/enrollments", requireAuth, async (req: Request, res: Response) => {
    try {
      const { studentId, courseOfferingId } = req.query;
      const list = await storage.listEnrollments({
        studentId: studentId as string,
        courseOfferingId: courseOfferingId as string,
      });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/enrollment/bulk", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { courseOfferingId } = req.body;
      if (!courseOfferingId) {
        return res.status(400).json({ message: "courseOfferingId is required" });
      }
      const co = await storage.getCourseOffering(courseOfferingId);
      if (!co) return res.status(404).json({ message: "Course offering not found" });

      // Find students in the same institute, filtering by division if applicable
      const allUsers = await storage.listUsers();
      const students = allUsers.filter((u: any) =>
        u.role === "student" && u.status === "active" && u.instituteId === co.instituteId
      );

      // Get existing enrollments to avoid duplicates
      const existing = await storage.listEnrollments({ courseOfferingId });
      const existingStudentIds = new Set(existing.map((e: any) => e.studentId));

      let enrolledCount = 0;
      for (const student of students) {
        if (existingStudentIds.has(student.id)) continue;
        await storage.createEnrollment({
          studentId: student.id,
          courseOfferingId,
          enrollmentType: "admin_assigned",
          status: "active",
          enrolledByAdminId: req.user?.userId,
        } as any);
        enrolledCount++;
      }

      // Update student count on the offering
      const updatedEnrollments = await storage.listEnrollments({ courseOfferingId });
      await storage.updateCourseOffering(courseOfferingId, { studentCount: updatedEnrollments.length } as any);

      res.json({ enrolledCount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/institutes/:id/hierarchy", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const tree = await storage.getHierarchyTree(id);
      if (!tree) return res.status(404).json({ message: "Institute not found" });
      res.json(tree);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/hierarchy", requireAuth, async (_req: Request, res: Response) => {
    try {
      const insts = await storage.listInstitutes();
      if (insts.length === 0) return res.json(null);
      const tree = await storage.getHierarchyTree(insts[0].id);
      res.json(tree);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/institutes/:id/schools", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const school = await storage.createSchool({ ...req.body, instituteId: req.params.id });
      res.status(201).json(school);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/schools/:instituteId", requireAuth, async (req: Request, res: Response) => {
    try {
      res.json(await storage.listSchools(req.params.instituteId as string));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/schools/:id/departments", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const school = await storage.getSchool(id);
      if (!school) return res.status(404).json({ message: "School not found" });
      const dept = await storage.createDepartment({ ...req.body, schoolId: req.params.id, instituteId: school.instituteId });
      res.status(201).json(dept);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/departments/:id/programs", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const dept = await storage.getDepartment(id);
      if (!dept) return res.status(404).json({ message: "Department not found" });
      const prog = await storage.createProgram({ ...req.body, departmentId: req.params.id, schoolId: dept.schoolId, instituteId: dept.instituteId });
      res.status(201).json(prog);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/programs/:id/years", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const yr = await storage.createYear({ ...req.body, programId: req.params.id });
      res.status(201).json(yr);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/years/:id/divisions", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const yr = await storage.getYear(id);
      if (!yr) return res.status(404).json({ message: "Year not found" });
      const div = await storage.createDivision({ ...req.body, yearId: req.params.id, programId: yr.programId });
      res.status(201).json(div);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/institutes/:id/terms", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const term = await storage.createTerm({ ...req.body, instituteId: req.params.id });
      res.status(201).json(term);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── HIERARCHY NODE CRUD (update + retire) ──────────────────────────────────
  // Generic PATCH/DELETE for each entity type
  app.patch("/api/hierarchy/institute/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const result = await storage.updateInstitute(req.params.id as string, req.body);
      if (!result) return res.status(404).json({ message: "Institute not found" });
      res.json(result);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/hierarchy/school/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const result = await storage.updateSchool(req.params.id as string, req.body);
      if (!result) return res.status(404).json({ message: "School not found" });
      res.json(result);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });
  app.delete("/api/hierarchy/school/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteSchool(req.params.id as string);
      res.json({ message: "School retired" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/hierarchy/department/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const result = await storage.updateDepartment(req.params.id as string, req.body);
      if (!result) return res.status(404).json({ message: "Department not found" });
      res.json(result);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });
  app.delete("/api/hierarchy/department/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteDepartment(req.params.id as string);
      res.json({ message: "Department retired" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/hierarchy/program/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const result = await storage.updateProgram(req.params.id as string, req.body);
      if (!result) return res.status(404).json({ message: "Program not found" });
      res.json(result);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });
  app.delete("/api/hierarchy/program/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteProgram(req.params.id as string);
      res.json({ message: "Program retired" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/hierarchy/year/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const result = await storage.updateYear(req.params.id as string, req.body);
      if (!result) return res.status(404).json({ message: "Year not found" });
      res.json(result);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });
  app.delete("/api/hierarchy/year/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteYear(req.params.id as string);
      res.json({ message: "Year retired" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/hierarchy/division/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const result = await storage.updateDivision(req.params.id as string, req.body);
      if (!result) return res.status(404).json({ message: "Division not found" });
      res.json(result);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });
  app.delete("/api/hierarchy/division/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteDivision(req.params.id as string);
      res.json({ message: "Division retired" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/terms/:instituteId", requireAuth, async (req: Request, res: Response) => {
    try {
      res.json(await storage.listTerms(req.params.instituteId as string));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/courses", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
    try {
      const course = await storage.createCourse(req.body);
      res.status(201).json(course);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/courses", requireAuth, async (req: Request, res: Response) => {
    try {
      const { instituteId, departmentId } = req.query;
      const list = await storage.listCourses({
        instituteId: instituteId as string,
        departmentId: departmentId as string,
      });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/courses/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const course = await storage.getCourse(req.params.id as string);
      if (!course) return res.status(404).json({ message: "Course not found" });
      res.json(course);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/courses/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const course = await storage.updateCourse(id, req.body);
      if (!course) return res.status(404).json({ message: "Course not found" });
      res.json(course);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/courses/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      await storage.deleteCourse(id);
      res.json({ message: "Course deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/course-offerings", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
    try {
      const offering = await storage.createCourseOffering(req.body);
      res.status(201).json(offering);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/course-offerings", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseId, termId, instituteId } = req.query;
      const list = await storage.listCourseOfferings({
        courseId: courseId as string,
        termId: termId as string,
        instituteId: instituteId as string,
      });

      const enriched = await Promise.all(list.map(async (co) => {
        const course = await storage.getCourse(co.courseId);
        const teacherIds = (co.teachers as any[] || []).map((t: any) => t.teacherId);
        const teacherUsers = await Promise.all(teacherIds.map((tid: string) => storage.getUser(tid)));
        return {
          ...co,
          course: course || { id: co.courseId, code: "", name: "Unknown Course", description: "", prerequisites: [] },
          teachers: teacherUsers.filter(Boolean).map(sanitizeUser),
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/course-offerings/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const co = await storage.getCourseOffering(id);
      if (!co) return res.status(404).json({ message: "Course offering not found" });

      const course = await storage.getCourse(co.courseId);
      const teacherIds = (co.teachers as any[] || []).map((t: any) => t.teacherId);
      const teacherUsers = await Promise.all(teacherIds.map((tid: string) => storage.getUser(tid)));

      res.json({
        ...co,
        course: course || { id: co.courseId, code: "", name: "Unknown Course", description: "", prerequisites: [] },
        teachers: teacherUsers.filter(Boolean).map(sanitizeUser),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/course-offerings/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const co = await storage.updateCourseOffering(id, req.body);
      if (!co) return res.status(404).json({ message: "Course offering not found" });
      res.json(co);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/courses/:offeringId/teachers", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { offeringId } = req.params as { offeringId: string };
      const co = await storage.getCourseOffering(offeringId);
      if (!co) return res.status(404).json({ message: "Course offering not found" });
      const { teacherId, sectionNames } = req.body;
      const currentTeachers = (co.teachers as any[]) || [];
      currentTeachers.push({ teacherId, sectionNames: sectionNames || [], assignedAt: new Date().toISOString() });
      const updated = await storage.updateCourseOffering(offeringId, { teachers: currentTeachers });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/courses/:offeringId/teachers/:teacherId", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { offeringId, teacherId } = req.params as { offeringId: string, teacherId: string };
      const co = await storage.getCourseOffering(offeringId);
      if (!co) return res.status(404).json({ message: "Course offering not found" });
      const currentTeachers = ((co.teachers as any[]) || []).filter((t: any) => t.teacherId !== teacherId);
      const updated = await storage.updateCourseOffering(offeringId, { teachers: currentTeachers });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/enrollments", requireAuth, async (req: Request, res: Response) => {
    try {
      const enrollment = await storage.createEnrollment(req.body);
      res.status(201).json(enrollment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/enrollments", requireAuth, async (req: Request, res: Response) => {
    try {
      const { studentId, courseOfferingId } = req.query;
      const list = await storage.listEnrollments({
        studentId: studentId as string,
        courseOfferingId: courseOfferingId as string,
      });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/enrollment/bulk", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { studentIds, courseOfferingId, sectionName } = req.body;
      const results = [];
      for (const studentId of studentIds) {
        const enrollment = await storage.createEnrollment({
          studentId,
          courseOfferingId,
          sectionName,
          enrollmentType: "admin_assigned",
          status: "active",
        });
        results.push(enrollment);
      }
      res.status(201).json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/me/enroll", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseOfferingId, sectionName } = req.body;
      const co = await storage.getCourseOffering(courseOfferingId);
      if (!co) return res.status(404).json({ message: "Course offering not found" });

      const enrollment = await storage.createEnrollment({
        studentId: req.user!.userId,
        courseOfferingId,
        sectionName,
        enrollmentType: "student_selected",
        status: (co.studentCount || 0) >= (co.capacity || 100) ? "waitlisted" : "active",
      });

      await storage.updateCourseOffering(courseOfferingId, {
        studentCount: (co.studentCount || 0) + 1,
      });

      res.status(enrollment.status === "waitlisted" ? 202 : 200).json(enrollment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/me/enroll/:enrollmentId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { enrollmentId } = req.params as { enrollmentId: string };
      const enrollment = await storage.getEnrollment(enrollmentId);
      if (!enrollment) return res.status(404).json({ message: "Enrollment not found" });
      if (enrollment.studentId !== req.user!.userId) return res.status(403).json({ message: "Not your enrollment" });
      if (enrollment.enrollmentType !== "student_selected") return res.status(400).json({ message: "Cannot unenroll from admin-assigned courses" });

      await storage.updateEnrollment(enrollmentId, { status: "withdrawn" });
      res.json({ message: "Unenrolled successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/enrollment/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      await storage.deleteEnrollment(id);

      await storage.createAuditLog({
        actorId: req.user!.userId,
        actorRole: req.user!.role,
        action: "DELETE_ENROLLMENT",
        targetId: id,
        targetType: "enrollment",
        ipAddress: req.ip,
        metadata: { reason: req.body.reason },
      });

      res.json({ message: "Enrollment removed" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/me/courses", requireAuth, async (req: Request, res: Response) => {
    try {
      const myEnrollments = await storage.listEnrollments({ studentId: req.user!.userId });
      const activeEnrollments = myEnrollments.filter(e => e.status === "active");

      const result = await Promise.all(activeEnrollments.map(async (enrollment) => {
        const co = await storage.getCourseOffering(enrollment.courseOfferingId);
        if (!co) return null;
        const course = await storage.getCourse(co.courseId);
        const teacherIds = (co.teachers as any[] || []).map((t: any) => t.teacherId);
        const teacherUsers = await Promise.all(teacherIds.map((tid: string) => storage.getUser(tid)));

        return {
          ...co,
          course: course || { id: co.courseId, code: "", name: "Unknown", description: "", prerequisites: [] },
          teachers: teacherUsers.filter(Boolean).map(sanitizeUser),
          enrollmentId: enrollment.id,
          progress: enrollment.progress || 0,
        };
      }));

      res.json(result.filter(Boolean));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/content", requireAuth, requireRole("teacher", "admin"), upload.single("file"), async (req: Request, res: Response) => {
    try {
      const { title, courseOfferingId, description, contentType, type, tags } = req.body;

      if (!courseOfferingId) {
        return res.status(400).json({ message: "courseOfferingId is required to upload content" });
      }

      const contentItem = await storage.createContentItem({
        title,
        courseOfferingId,
        description,
        type: type || contentType || "document",
        tags: tags ? JSON.parse(tags) : [],
        ownerTeacherId: req.user!.userId,
        uploadedBy: req.user!.userId,
        originalFilePath: req.file?.path,
        originalMimeType: req.file?.mimetype,
        originalSizeBytes: req.file?.size,
        originalFilename: req.file?.originalname,
        fileSize: req.file ? `${(req.file.size / (1024 * 1024)).toFixed(1)} MB` : undefined,
        publishStatus: "draft",
        formats: ["original"],
        conversionProgress: { tier1: "in_progress", tier2: "in_progress" },
      });

      // ─── TRIGGER TIER 1 CONVERSIONS (PostgreSQL per-column version) ──────────────
      // Run conversions asynchronously — do not await, so the upload response is instant
      (async () => {
        if (activeConversions >= MAX_CONCURRENT_CONVERSIONS) {
          console.warn(
            `[Conversion] ⚠️ Max concurrent conversions reached (${MAX_CONCURRENT_CONVERSIONS}). Queuing ${contentItem.id}.`
          );
          // Wait until a slot opens — poll every 3 seconds
          await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              if (activeConversions < MAX_CONCURRENT_CONVERSIONS) {
                clearInterval(interval);
                resolve();
              }
            }, 3000);
          });
        }
        activeConversions++;
        console.log(
          `[Conversion] 🔄 Active conversions: ${activeConversions}/${MAX_CONCURRENT_CONVERSIONS}`
        );
        const {
          extractText,
          generateSimplifiedText,
          generateTranscript,
          generateHighContrastPdf,
          generateAudioFile,
          generateBraille,
        } = await import('./services/conversionService');
        const {
          isAzureConfigured,
          uploadBuffer: azureUploadBuffer,
        } = await import('./services/blobStorage');

        const contentId = contentItem.id;
        const file = req.file;
        if (!file) return;

        const useAzure = isAzureConfigured();

        // ─── MIRROR ORIGINAL TO AZURE (Railway/Cloud Support) ─────────────
        if (useAzure) {
          try {
            const originalBlobPath = `original/${contentId}/${file.originalname}`;
            const fileBuffer = fs.readFileSync(file.path);
            await azureUploadBuffer(originalBlobPath, fileBuffer, file.mimetype);
            await storage.updateContentItem(contentId, { originalFilePath: originalBlobPath });
            console.log(`[Conversion] ✅ Original mirrored to Azure: ${originalBlobPath}`);
          } catch (e) {
            console.error(`[Conversion] ❌ Failed to mirror original to Azure:`, e);
          }
        }

        const isPdfOrDoc =
          file.mimetype === 'application/pdf' ||
          file.mimetype.includes('wordprocessingml') ||
          file.originalname.endsWith('.txt');

        // Read the uploaded file from disk into a buffer
        const fileBuffer = fs.readFileSync(file.path);

        // Ensure local fallback directory exists
        const convertedDir = path.join(process.cwd(), 'uploads', 'converted', contentId);
        console.log(`[Conversion] CWD: ${process.cwd()}`);
        console.log(`[Conversion] Target Dir: ${convertedDir}`);
        if (!fs.existsSync(convertedDir)) {
          console.log(`[Conversion] Creating dir: ${convertedDir}`);
          fs.mkdirSync(convertedDir, { recursive: true });
        }

        // Helper: save a buffer either to Azure Blob or local disk
        async function saveFile(filename: string, buffer: Buffer, mimeType: string): Promise<string> {
          // ALWAYS save locally first
          const localPath = path.join(convertedDir, filename);
          console.log(`[Conversion] Writing file: ${localPath}`);
          fs.writeFileSync(localPath, buffer);

          if (useAzure) {
            const blobPath = `converted/${contentId}/${filename}`;
            await azureUploadBuffer(blobPath, buffer, mimeType);
            return blobPath;
          } else {
            // Return a RELATIVE path from the project root — not absolute
            return `uploads/converted/${contentId}/${filename}`;
          }
        }

        // Helper: update content item columns
        const updateItem = async (fields: Record<string, any>) => {
          await storage.updateContentItem(contentId, fields);
        };

        try {
          // ── Extract raw text ────────────────────────────────────────
          let rawText = '';
          if (isPdfOrDoc) {
            rawText = await extractText(fileBuffer, file.mimetype, file.originalname);
            console.log(`[Conversion] Extracted ${rawText.length} chars from ${file.originalname}`);

            if (rawText.trim().length < 50) {
              console.warn(`[Conversion] ⚠️ Extracted text too short (${rawText.length} chars). File may be a scanned image or empty. Skipping text-based conversions.`);
              await updateItem({
                transcriptStatus: 'FAILED',
                simplifiedStatus: 'FAILED',
                audioStatus: 'FAILED',
                conversionError: 'Text extraction returned empty content. File may be a scanned image PDF.'
              });
              rawText = ''; // Clear text to prevent downstream failures
            }
          }

          // ── TRANSCRIPT ─────────────────────────────────────────────
          if (isPdfOrDoc && rawText) {
            try {
              const transcriptText = generateTranscript(rawText, file.originalname);
              const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
              const transcriptPath = await saveFile('transcript.txt', transcriptBuffer, 'text/plain');
              // Update BOTH availableFormats and transcriptPath column
              await updateItem({ transcriptPath, transcriptStatus: 'COMPLETED' });
              await patchAvailableFormats(contentId, 'transcript', transcriptPath, 'COMPLETED');
              console.log(`[Conversion] ✅ Transcript done for ${contentId}`);
            } catch (e) {
              console.error('[Conversion] ❌ Transcript failed:', e);
              await updateItem({ transcriptStatus: 'FAILED', conversionError: String(e) });
            }
          }

          // ── SIMPLIFIED TEXT ────────────────────────────────────────
          if (isPdfOrDoc && rawText) {
            try {
              const simplifiedText = await generateSimplifiedText(rawText);
              const simplifiedBuffer = Buffer.from(simplifiedText, 'utf-8');
              const simplifiedPath = await saveFile('simplified.txt', simplifiedBuffer, 'text/plain');
              await updateItem({ simplifiedPath, simplifiedStatus: 'READYFORREVIEW' });
              await patchAvailableFormats(contentId, 'simplified', simplifiedPath, 'READYFORREVIEW');
              console.log(`[Conversion] ✅ Simplified done for ${contentId}`);
            } catch (e) {
              console.error('[Conversion] ❌ Simplified failed:', e);
              await updateItem({ simplifiedStatus: 'FAILED' });
            }
          }

          // ── BRAILLE ────────────────────────────────────────────────
          if (isPdfOrDoc && rawText) {
            try {
              const brailleText = generateBraille(rawText);
              const brailleBuffer = Buffer.from(brailleText, 'utf-8');
              const braillePath = await saveFile('braille.brf', brailleBuffer, 'text/plain');
              await updateItem({ braillePath, brailleStatus: 'COMPLETED' });
              await patchAvailableFormats(contentId, 'braille', braillePath, 'COMPLETED');
              console.log(`[Conversion] ✅ Braille done for ${contentId}`);
            } catch (e) {
              console.error('[Conversion] ❌ Braille failed:', e);
              await updateItem({ brailleStatus: 'FAILED' });
            }
          }

          // ── HIGH CONTRAST PDF ──────────────────────────────────────
          if (file.mimetype === 'application/pdf') {
            try {
              const hcBuffer = await generateHighContrastPdf(fileBuffer);
              if (hcBuffer) {
                const highContrastPath = await saveFile('high-contrast.pdf', hcBuffer, 'application/pdf');
                await updateItem({ highContrastPath, highContrastStatus: 'COMPLETED' });
                await patchAvailableFormats(contentId, 'highContrast', highContrastPath, 'COMPLETED');
                console.log(`[Conversion] ✅ High contrast PDF done for ${contentId}`);
              } else {
                await updateItem({ highContrastStatus: 'FAILED' });
                console.warn(`[Conversion] ⚠️ High contrast returned null for ${contentId}`);
              }
            } catch (e) {
              console.error('[Conversion] ❌ High contrast failed:', e);
              await updateItem({ highContrastStatus: 'FAILED' });
            }
          }

          // ── AUDIO (TTS script) ─────────────────────────────────────
          if (isPdfOrDoc && rawText) {
            try {
              const { buffer: audioBuffer, mimeType: audioMime, extension } =
                await generateAudioFile(rawText, file.originalname);
              const audioPath = await saveFile(`audio.${extension}`, audioBuffer, audioMime);
              await updateItem({ audioPath, audioStatus: 'COMPLETED' });
              await patchAvailableFormats(contentId, 'audio', audioPath, 'COMPLETED');
              console.log(`[Conversion] ✅ Audio script done for ${contentId}`);
            } catch (e) {
              console.error('[Conversion] ❌ Audio failed:', e);
              await updateItem({ audioStatus: 'FAILED' });
            }
          }

          // ── MARK PUBLISHED ─────────────────────────────────────────
          await storage.updateContentItem(contentId, { publishStatus: 'review_required' });
          console.log(`[Conversion] 🎉 Content ${contentId} fully converted & published (${useAzure ? 'Azure' : 'local'})`);

        } catch (outerErr) {
          console.error('[Conversion] 💥 Outer conversion block crashed:', outerErr);
          await storage.updateContentItem(contentId, {
            publishStatus: 'failed',
            conversionError: String(outerErr),
          });
        } finally {
          activeConversions--;
          console.log(
            `[Conversion] ✅ Slot released. Active: ${activeConversions}/${MAX_CONCURRENT_CONVERSIONS}`
          );
        }
      })();
      // ─── END CONVERSION TRIGGER ───────────────────────────────────────────────────

      res.status(201).json(contentItem);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/content", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseOfferingId, publishStatus, uploadedBy } = req.query;
      const list = await storage.listContentItems({
        courseOfferingId: courseOfferingId as string,
        publishStatus: publishStatus as string,
        uploadedBy: uploadedBy as string,
      });
      const enriched = list.map((item) => {
          const formats: string[] = [];
          if (item.transcriptStatus === 'COMPLETED') formats.push('transcript');
          if (item.simplifiedStatus === 'COMPLETED' || item.simplifiedStatus === 'READYFORREVIEW') formats.push('simplified');
          if (item.audioStatus === 'COMPLETED') formats.push('audio');
          if (item.highContrastStatus === 'COMPLETED') formats.push('high_contrast');
          if (item.brailleStatus === 'COMPLETED') formats.push('braille');

          const t1Done = item.transcriptStatus === 'COMPLETED' && item.audioStatus === 'COMPLETED';
          const t1Active = item.transcriptStatus === 'PENDING' || item.audioStatus === 'PENDING' || 
                           item.publishStatus === 'converting';
          const t2Done = (item.simplifiedStatus === 'COMPLETED' || item.simplifiedStatus === 'READYFORREVIEW') &&
                         item.highContrastStatus === 'COMPLETED';
          const t2Active = item.simplifiedStatus === 'PENDING' || item.highContrastStatus === 'PENDING';

          const conversionProgress = {
            tier1: t1Done ? 'completed' : t1Active ? 'in_progress' : 'pending',
            tier2: t2Done ? 'completed' : t2Active ? 'in_progress' : 'pending',
          };

          return { ...item, formats, conversionProgress };
        });
        res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/content/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const item = await storage.getContentItem(id);
      if (!item) return res.status(404).json({ message: "Content item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── SERVE CONVERTED FORMAT CONTENT ──────────────────────────────────────────
  app.get("/api/content/:id/format/:format", requireAuth, async (req: Request, res: Response) => {
    try {
      const item = await storage.getContentItem(req.params.id as string);
      if (!item) return res.status(404).json({ message: "Content item not found" });

      const formatKey = req.params.format as string;
      const formats = (item.availableFormats as Record<string, any>) || {};
      const formatData = formats[formatKey];

      if (!formatData || !formatData.path) {
        return res.status(404).json({ message: `Format '${formatKey}' not available` });
      }

      if (formatData.status !== 'COMPLETED' && formatData.status !== 'APPROVED' && formatData.status !== 'READYFORREVIEW') {
        return res.status(404).json({ message: `Format '${formatKey}' is not ready (status: ${formatData.status})` });
      }

      const filePath: string = formatData.path;

      // Determine content type from the file extension
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const mimeMap: Record<string, string> = {
        'txt': 'text/plain; charset=utf-8',
        'pdf': 'application/pdf',
        'html': 'text/html; charset=utf-8',
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
      };
      const contentType = mimeMap[ext] || 'application/octet-stream';

      // Check if this is an Azure Blob path (no drive letter or absolute path prefix)
      const isAzurePath = !path.isAbsolute(filePath) && !filePath.startsWith('.');

      if (isAzurePath) {
        // Fetch from Azure Blob Storage
        const { downloadBuffer } = await import('./services/blobStorage');
        const buffer = await downloadBuffer(filePath);
        if (!buffer) return res.status(404).json({ message: "File not found in blob storage" });
        res.setHeader('Content-Type', contentType);
        res.send(buffer);
      } else {
        // Read from local disk
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found on disk" });
        }
        res.setHeader('Content-Type', contentType);
        res.send(fs.readFileSync(filePath));
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/content/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const item = await storage.updateContentItem(id, req.body);
      if (!item) return res.status(404).json({ message: "Content item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/content/:id/publish", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const item = await storage.updateContentItem(id, { publishStatus: "published" });
      if (!item) return res.status(404).json({ message: "Content item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/content/:id/soft-delete", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const item = await storage.softDeleteContentItem(id, req.user!.userId);
      if (!item) return res.status(404).json({ message: "Content item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── IMPACT CHECK ──────────────────────────────────────────
  app.get("/api/content/:id/impact", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const impact = await storage.getContentImpact(id);
      res.json(impact);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── RESTORE FROM TRASH ────────────────────────────────────
  app.post("/api/content/:id/restore", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const item = await storage.restoreContentItem(id);
      if (!item) return res.status(404).json({ message: "Content item not found" });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── PERMANENT DELETE (admin only) ─────────────────────────
  app.delete("/api/content/:id/permanent", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      await storage.permanentDeleteContentItem(id);
      res.json({ message: "Content permanently deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── KOKORO TTS GENERATION ───────────────────────────────────
  app.post("/api/tts/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { text, voice = "af_bella", contentId } = req.body;
      if (!text) return res.status(400).json({ message: "text is required" });

      const cacheDir = path.join(process.cwd(), "uploads", "tts-cache");
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

      // Cache key based on full text hash
      const crypto = await import("crypto");
      const textHash = crypto
        .createHash("md5")
        .update(`${voice}:${text}`)
        .digest("hex");
      const cachePath = path.join(cacheDir, `${textHash}.wav`);

      if (fs.existsSync(cachePath)) {
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return fs.createReadStream(cachePath).pipe(res);
      }

      const tts = await getKokoroTTS();

      // ── CHUNK LONG TEXT ──────────────────────────────────────
      // Split on sentence boundaries, group into ~400 char chunks
      const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
      const chunks: string[] = [];
      let current = "";
      for (const sentence of sentences) {
        if ((current + sentence).length > 400 && current.length > 0) {
          chunks.push(current.trim());
          current = sentence;
        } else {
          current += sentence;
        }
      }
      if (current.trim()) chunks.push(current.trim());
      // ── END CHUNKING ─────────────────────────────────────────

      if (chunks.length === 1) {
        // Single chunk — save directly
        const audio = await tts.generate(chunks[0], { voice });
        await audio.save(cachePath);
      } else {
        // Multiple chunks — generate each, concatenate raw PCM, write WAV
        const audioBuffers: Buffer[] = [];
        let sampleRate = 24000;
        let numChannels = 1;

        for (const chunk of chunks) {
          const chunkPath = path.join(
            cacheDir,
            `${textHash}_chunk_${audioBuffers.length}.wav`
          );
          const audio = await tts.generate(chunk, { voice });
          await audio.save(chunkPath);

          // Read WAV — skip 44-byte header for all but first
          const wavBuffer = fs.readFileSync(chunkPath);
          audioBuffers.push(
            audioBuffers.length === 0
              ? wavBuffer                   // keep header from first chunk
              : wavBuffer.slice(44)         // strip header from rest
          );
          fs.unlinkSync(chunkPath);         // cleanup temp chunk file
        }

        // Fix the data size in the WAV header of the combined buffer
        const combined = Buffer.concat(audioBuffers);
        const dataSize = combined.length - 44;
        combined.writeUInt32LE(dataSize + 36, 4);   // RIFF chunk size
        combined.writeUInt32LE(dataSize, 40);        // data chunk size
        fs.writeFileSync(cachePath, combined);
      }

      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fs.createReadStream(cachePath).pipe(res);

    } catch (error: any) {
      console.error("[Kokoro] Generation error:", error);
      res.status(500).json({
        message: "TTS generation failed.",
        error: error.message,
      });
    }
  });

  // ── KOKORO VOICES LIST ────────────────────────────────────
  app.get("/api/tts/voices", requireAuth, async (_req: Request, res: Response) => {
    const voices = [
      { id: "af_heart",    name: "Heart",    gender: "F", accent: "American" },
      { id: "af_bella",    name: "Bella",    gender: "F", accent: "American" },
      { id: "af_sarah",    name: "Sarah",    gender: "F", accent: "American" },
      { id: "af_nicole",   name: "Nicole",   gender: "F", accent: "American" },
      { id: "am_michael",  name: "Michael",  gender: "M", accent: "American" },
      { id: "am_fenrir",   name: "Fenrir",   gender: "M", accent: "American" },
      { id: "am_puck",     name: "Puck",     gender: "M", accent: "American" },
      { id: "bf_emma",     name: "Emma",     gender: "F", accent: "British"  },
      { id: "bf_isabella", name: "Isabella", gender: "F", accent: "British"  },
      { id: "bm_george",   name: "George",   gender: "M", accent: "British"  },
      { id: "bm_fable",    name: "Fable",    gender: "M", accent: "British"  },
    ];
    res.json(voices);
  });

  app.get("/api/content/:id/delete-impact", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const item = await storage.getContentItem(id);
      if (!item) return res.status(404).json({ message: "Content item not found" });

      res.json({
        viewCount: item.viewCount || 0,
        studentsWithProgressRecord: item.progressCount || 0,
        linkedAssessments: (item.linkedAssessments as string[]).map(id => ({ id, title: "Assessment" })),
        activeViewersLast24h: 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── SIGNED URL FOR FORMAT CONTENT ───────────────────────────────────────────
  // GET /api/content/:contentId/format-url
  app.get("/api/content/:contentId/format-url", requireAuth, async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params as { contentId: string };
      const { format, redirect: shouldRedirect } = req.query as { format: string; redirect?: string };

      const item = await storage.getContentItem(contentId);
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      const pathMap: Record<string, string | null> = {
        original: (item as any).originalFilePath ?? null,
        transcript: (item as any).transcriptPath ?? null,
        simplified: (item as any).simplifiedPath ?? null,
        audio: (item as any).audioPath ?? null,
        highContrast: (item as any).highContrastPath ?? null,
        high_contrast: (item as any).highContrastPath ?? null,
        braille: (item as any).braillePath ?? null,
      };

      // Fallback: legacy JSONB lookup
      const formats = (item.availableFormats as Record<string, any>) || {};
      const fallbackPath = formats[format]?.path ?? null;

      const filePath = pathMap[format] ?? fallbackPath ?? null;

      if (!filePath) {
        return res.status(404).json({
          error: `Format '${format}' is not yet available for this content item.`
        });
      }

      // Check if this is an Azure blob path (starts with "converted/" or "original/")
      const isAzurePath = filePath.startsWith('converted/') || filePath.startsWith('original/');
      const isLocalPath = filePath.startsWith('uploads/') || filePath.includes('\\');

      // PREFER LOCAL: check if the file actually exists on disk (fallback/dev mode)
      const relativeLocalPath = isAzurePath ? `uploads/${filePath}` : filePath;
      const absoluteLocalPath = path.join(process.cwd(), relativeLocalPath);

      if (fs.existsSync(absoluteLocalPath)) {
        const url = `/api/content/file/${relativeLocalPath.replace(/\\/g, '/')}`;
        if (shouldRedirect === 'true') return res.redirect(url);
        return res.json({ url, source: 'local' });
      }

      if (isAzurePath) {
        // Azure: generate SIGNED URL for private containers
        const { isAzureConfigured, getSignedUrl } = await import('./services/blobStorage');
        if (isAzureConfigured()) {
          const url = await getSignedUrl(filePath, 2); // 2 hour expiry
          if (shouldRedirect === 'true') return res.redirect(url);
          return res.json({ url, source: 'azure' });
        }
      }

      if (isLocalPath) {
        // Local: serve the file directly from disk via a signed server route
        const normalizedPath = filePath.replace(/\\\\/g, '/').replace(/^.*uploads\//, 'uploads/');
        const url = `/api/content/file/${normalizedPath}`;
        if (shouldRedirect === 'true') return res.redirect(url);
        return res.json({ url, source: 'local' });
      }

      return res.status(404).json({ error: 'File not found on local or cloud storage' });

    } catch (err: any) {
      console.error('[FormatURL] Error:', err.message);
      return res.status(500).json({ error: 'Failed to resolve format URL', detail: err.message });
    }
  });

  app.get("/api/content/trash", requireAuth, async (req: Request, res: Response) => {
    try {
      const list = await storage.listContentItems({ publishStatus: "soft_deleted" });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/student/content", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseOfferingId } = req.query;
      const list = await storage.listContentItems({
        courseOfferingId: courseOfferingId as string,
        publishStatus: "published",
      });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/conversion-jobs", requireAuth, async (req: Request, res: Response) => {
    try {
      const { contentId, courseOfferingId, status } = req.query;
      const list = await storage.listConversionJobs({
        contentId: contentId as string,
        courseOfferingId: courseOfferingId as string,
        status: status as string,
      });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/conversions/my-queue", requireAuth, async (req: Request, res: Response) => {
    try {
      const list = await storage.listConversionJobs({ status: "ready_for_review" });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/conversions/:jobId/approve", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params as { jobId: string };
      const job = await storage.updateConversionJob(jobId, {
        status: "approved",
        reviewedByTeacherId: req.user!.userId,
        reviewedAt: new Date(),
      });
      if (!job) return res.status(404).json({ message: "Conversion job not found" });
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/conversions/:jobId/reject", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params as { jobId: string };
      const job = await storage.updateConversionJob(jobId, {
        status: "rejected",
        reviewedByTeacherId: req.user!.userId,
        reviewedAt: new Date(),
      });
      if (!job) return res.status(404).json({ message: "Conversion job not found" });
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/conversions/:jobId/retry", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params as { jobId: string };
      const job = await storage.getConversionJob(jobId);
      if (!job) return res.status(404).json({ message: "Conversion job not found" });
      const updated = await storage.updateConversionJob(jobId, {
        status: "pending",
        retryCount: (job.retryCount || 0) + 1,
        errorMessage: null,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/conversions", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { status } = req.query;
      const list = await storage.listConversionJobs({ status: status as string });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assessments", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const assessment = await storage.createAssessment({
        ...req.body,
        ownerTeacherId: req.user!.userId,
        questionCount: req.body.questions?.length || 0,
      });
      res.status(201).json(assessment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/assessments", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseOfferingId } = req.query;
      const list = await storage.listAssessments({
        courseOfferingId: courseOfferingId as string,
      });

      if (req.user!.role === "student") {
        const enriched = await Promise.all(list.map(async (a) => {
          const sub = await storage.getSubmissionByStudentAndAssessment(req.user!.userId, a.id);
          return {
            ...a,
            status: sub ? (sub.status === "graded" ? "graded" : sub.status === "submitted" ? "completed" : sub.status) : "upcoming",
            score: sub?.totalScore,
          };
        }));
        return res.json(enriched);
      }

      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/assessments/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const assessment = await storage.getAssessment(id);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });

      if (req.user!.role === "student") {
        const sub = await storage.getSubmissionByStudentAndAssessment(req.user!.userId, assessment.id);
        return res.json({
          ...assessment,
          status: sub ? (sub.status === "graded" ? "graded" : sub.status === "submitted" ? "completed" : sub.status) : "upcoming",
          score: sub?.totalScore,
          submission: sub,
        });
      }

      res.json(assessment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/assessments/:id", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const assessment = await storage.updateAssessment(id, req.body);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });
      res.json(assessment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/assessments/:id", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      await storage.deleteAssessment(id);
      res.json({ message: "Assessment deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── CONTENT PROGRESS TRACKING ───────────────────────────────────────────────
  app.post("/api/content/:contentId/progress", requireAuth, async (req: Request, res: Response) => {
    try {
      const { progressPercent } = req.body;
      const { contentId } = req.params as { contentId: string };
      const studentId = req.user!.userId;

      const { contentProgress } = await import("@shared/schema");
      const { db } = await import("./db");

      await db.insert(contentProgress)
        .values({ studentId, contentId, progressPercent, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [contentProgress.studentId, contentProgress.contentId],
          set: { progressPercent, updatedAt: new Date() }
        });

      return res.json({ ok: true });
    } catch (error: any) {
      console.error('[Progress] Error saving progress:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/content/:contentId/progress", requireAuth, async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params as { contentId: string };
      const studentId = req.user!.userId;

      const { contentProgress } = await import("@shared/schema");
      const { db } = await import("./db");
      const { eq, and } = await import("drizzle-orm");

      const [progress] = await db.select()
        .from(contentProgress)
        .where(
          and(
            eq(contentProgress.studentId, studentId),
            eq(contentProgress.contentId, contentId)
          )
        );

      return res.json({ progressPercent: progress?.progressPercent || 0 });
    } catch (error: any) {
      console.error('[Progress] Error fetching progress:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assessments/:id/start", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const assessment = await storage.getAssessment(id);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });

      const existing = await storage.getSubmissionByStudentAndAssessment(req.user!.userId, id as string);
      if (existing && existing.status !== "paused") {
        return res.json(existing);
      }

      const user = await storage.getUser(req.user!.userId);
      const multiplier = (user?.preferences as any)?.extendedTimeMultiplier || 1.0;

      if (existing && existing.status === "paused") {
        const updated = await storage.updateSubmission(existing.id, {
          status: "in_progress",
          pausedAt: null,
        });
        return res.json(updated);
      }

      const submission = await storage.createSubmission({
        assessmentId: id,
        studentId: req.user!.userId,
        courseOfferingId: assessment.courseOfferingId,
        status: "in_progress",
        appliedTimeMultiplier: multiplier,
        timeStartedAt: new Date(),
        responses: [],
      });

      res.status(201).json(submission);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/assessments/:id/answer", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await storage.getSubmissionByStudentAndAssessment(req.user!.userId, id);
      if (!existing) return res.status(404).json({ message: "No active submission found" });

      const { questionId, responseType, textAnswer, filePath } = req.body;
      const responses = (existing.responses as any[]) || [];
      const idx = responses.findIndex((r: any) => r.questionId === questionId);
      const response = { questionId, responseType, textAnswer, filePath };

      if (idx >= 0) responses[idx] = response;
      else responses.push(response);

      const updated = await storage.updateSubmission(existing.id, { responses });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assessments/:id/save-exit", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await storage.getSubmissionByStudentAndAssessment(req.user!.userId, id);
      if (!existing) return res.status(404).json({ message: "No active submission found" });

      const updated = await storage.updateSubmission(existing.id, {
        status: "paused",
        pausedAt: new Date(),
        remainingSeconds: req.body.remainingSeconds,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assessments/:id/resume", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await storage.getSubmissionByStudentAndAssessment(req.user!.userId, id);
      if (!existing) return res.status(404).json({ message: "No submission found" });
      if (existing.status !== "paused") return res.status(400).json({ message: "Submission is not paused" });

      const updated = await storage.updateSubmission(existing.id, {
        status: "in_progress",
        pausedAt: null,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/assessments/:id/submit", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await storage.getSubmissionByStudentAndAssessment(req.user!.userId, id);
      if (!existing) return res.status(404).json({ message: "No active submission found" });

      const assessment = await storage.getAssessment(id);
      if (!assessment) return res.status(404).json({ message: "Assessment not found" });

      let totalScore = 0;
      const responses = (existing.responses as any[]) || [];
      const questions = (assessment.questions as any[]) || [];

      responses.forEach((resp: any) => {
        const q = questions.find((q: any) => q.id === resp.questionId);
        if (q && (q.type === "multiple_choice" || q.type === "multi_select") && q.correctAnswers) {
          const selectedIdx = q.options?.findIndex((o: any) => o.id === resp.textAnswer);
          if (q.correctAnswers.includes(selectedIdx)) {
            resp.score = q.marks || 1;
            totalScore += resp.score;
          } else {
            resp.score = 0;
          }
        }
      });

      const updated = await storage.updateSubmission(existing.id, {
        status: "submitted",
        timeSubmittedAt: new Date(),
        responses,
        totalScore,
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/threads", requireAuth, async (req: Request, res: Response) => {
    try {
      const thread = await storage.createThread(req.body);
      res.status(201).json(thread);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/threads", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseOfferingId } = req.query;
      const list = await storage.listThreads({
        courseOfferingId: courseOfferingId as string,
      });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/messages/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const allThreads = await storage.listThreads({});
      const unread = allThreads.filter(
        (t: any) =>
          Array.isArray(t.participants) &&
          t.participants.some((p: any) => p.id === userId) &&
          (t.unreadCount ?? 0) > 0
      );
      const count = unread.reduce((sum: number, t: any) => sum + (t.unreadCount ?? 0), 0);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/threads/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const thread = await storage.getThread(id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      res.json(thread);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/threads/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const list = await storage.listMessages(id);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/threads/:id/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      const message = await storage.createMessage({
        threadId: req.params.id as string,
        senderId: req.user!.userId,
        senderName: user?.name || "Unknown",
        senderRole: req.user!.role,
        content: req.body.content,
        type: req.body.type || "text",
      });

      const { id } = req.params as { id: string };
      await storage.updateThread(id, {
        lastMessage: req.body.content,
        lastMessageTime: new Date(),
      });

      res.status(201).json(message);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      const message = await storage.createMessage({
        ...req.body,
        senderId: req.user!.userId,
        senderName: user?.name || "Unknown",
        senderRole: req.user!.role,
      });

      if (req.body.threadId) {
        await storage.updateThread(req.body.threadId, {
          lastMessage: req.body.content,
          lastMessageTime: new Date(),
        });
      }

      res.status(201).json(message);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/announcements", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      const announcement = await storage.createAnnouncement({
        ...req.body,
        authorId: req.user!.userId,
        senderName: user?.name || "Unknown",
        senderRole: req.user!.role,
        urgent: req.body.urgent || req.body.isUrgent || false,
        publishedAt: new Date(),
      });
      res.status(201).json(announcement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/announcements", requireAuth, async (req: Request, res: Response) => {
    try {
      const { courseOfferingId } = req.query;
      const list = await storage.listAnnouncements({
        courseOfferingId: courseOfferingId as string,
      });
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/announcements/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params as { id: string };
      const announcement = await storage.getAnnouncement(id);
      if (!announcement) return res.status(404).json({ message: "Announcement not found" });
      res.json(announcement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/announcements/:id", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      const announcement = await storage.updateAnnouncement(req.params.id as string, req.body);
      if (!announcement) return res.status(404).json({ message: "Announcement not found" });
      res.json(announcement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/announcements/:id", requireAuth, requireRole("teacher", "admin"), async (req: Request, res: Response) => {
    try {
      await storage.deleteAnnouncement(req.params.id as string);
      res.json({ message: "Announcement deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/dashboard/stats", requireAuth, requireRole("admin"), async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/dashboard/alerts", requireAuth, requireRole("admin"), async (_req: Request, res: Response) => {
    try {
      const failedJobs = await storage.listConversionJobs({ status: "failed" });
      res.json({
        alerts: failedJobs.map(j => ({
          type: "conversion_failure",
          message: `Conversion failed: ${j.contentTitle} - ${j.formatType}`,
          jobId: j.id,
          errorMessage: j.errorMessage,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/users", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { role, search, status } = req.query;
      const userList = await storage.listUsers({
        role: role as string,
        search: search as string,
        status: status as string,
      });
      res.json(userList.map(sanitizeUser));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/users/:id/workload", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const allOfferings = await storage.listCourseOfferings();
      const teacherOfferings = allOfferings.filter(co =>
        (co.teachers as any[] || []).some((t: any) => t.teacherId === req.params.id)
      );
      const pendingJobs = await storage.listConversionJobs({ status: "ready_for_review" });

      res.json({
        assignedOfferings: teacherOfferings.length,
        pendingReviews: pendingJobs.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/audit-logs", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const { actorId, action } = req.query;
      const logs = await storage.listAuditLogs({
        actorId: actorId as string,
        action: action as string,
      });
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/settings", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const insts = await storage.listInstitutes();
      if (insts.length === 0) return res.json(null);
      const settings = await storage.getPlatformSettings(insts[0].id);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/settings/:section", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const insts = await storage.listInstitutes();
      if (insts.length === 0) return res.status(404).json({ message: "No institute found" });

      const updateData: any = {};
      updateData[req.params.section as string] = req.body;

      const settings = await storage.upsertPlatformSettings(insts[0].id, updateData);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/student/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const myEnrollments = await storage.listEnrollments({ studentId: req.user!.userId });
      const activeEnrollments = myEnrollments.filter(e => e.status === "active");
      console.log(`[Dashboard] Student ${req.user!.userId} has ${activeEnrollments.length} active enrollments: ${activeEnrollments.map(e => e.courseOfferingId).join(', ')}`);

      const coursesData = await Promise.all(activeEnrollments.map(async (enrollment) => {
        const co = await storage.getCourseOffering(enrollment.courseOfferingId);
        if (!co) {
          console.warn(`[Dashboard] Course offering ${enrollment.courseOfferingId} not found for enrollment ${enrollment.id}`);
          return null;
        }
        const course = await storage.getCourse(co.courseId);
        return {
          ...co,
          course: course || { id: co.courseId, code: "", name: "Unknown", description: "", prerequisites: [] },
          progress: enrollment.progress || 0,
        };
      }));

      const allContent = [];
      for (const enrollment of activeEnrollments) {
        const items = await storage.listContentItems({
          courseOfferingId: enrollment.courseOfferingId,
          publishStatus: "published",
        });
        console.log(` - Offering ${enrollment.courseOfferingId}: found ${items.length} published items`);
        allContent.push(...items);
      }

      const allAssessments = [];
      for (const enrollment of activeEnrollments) {
        const items = await storage.listAssessments({
          courseOfferingId: enrollment.courseOfferingId,
        });
        allAssessments.push(...items);
      }

      const recentAnnouncements = await storage.listAnnouncements();

      // Sort all content by date descending before slicing
      allContent.sort((a: any, b: any) => 
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );

      console.log(`[Dashboard] Found ${allContent.length} items for student ${req.user!.userId}. Returning top 5.`);
      allContent.slice(0, 5).forEach(c => console.log(` - ${c.title} (${c.courseOfferingId})`));

      res.json({
        courses: coursesData.filter(Boolean),
        recentContent: allContent.slice(0, 5),
        upcomingAssessments: allAssessments.slice(0, 5),
        announcements: recentAnnouncements.slice(0, 5),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/teacher/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const allOfferings = await storage.listCourseOfferings();
      const myOfferings = allOfferings.filter(co =>
        (co.teachers as any[] || []).some((t: any) => t.teacherId === req.user!.userId)
      );

      const coursesData = await Promise.all(myOfferings.map(async (co) => {
        const course = await storage.getCourse(co.courseId);
        const content = await storage.listContentItems({ courseOfferingId: co.id });
        return {
          ...co,
          course: course || { id: co.courseId, code: "", name: "Unknown", description: "", prerequisites: [] },
          contentCount: content.length,
          publishedCount: content.filter(c => c.publishStatus === "published").length,
        };
      }));

      const pendingReviews = await storage.listConversionJobs({ status: "ready_for_review" });

      res.json({
        courses: coursesData,
        pendingReviews: pendingReviews.length,
        conversionQueue: pendingReviews.slice(0, 10),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/analytics/events", requireAuth, async (req: Request, res: Response) => {
    try {
      const event = await storage.createAnalyticsEvent({
        userId: req.user!.userId,
        ...req.body,
      });
      res.status(201).json(event);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics", requireAuth, requireRole("admin"), async (_req: Request, res: Response) => {
    try {
      const stats = await storage.getAdminStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── BRAILLE BACKFILL (one-time admin utility) ──────────────
  app.post("/api/admin/backfill-braille", requireAuth, 
    async (req: Request, res: Response) => {
    try {
      // Only allow teacher/admin roles
      const user = (req as any).user;
      if (user?.role !== 'teacher' && user?.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Get all content items that have a transcript but no braille
      const allItems = await storage.listContentItems();
      const candidates = allItems.filter((item: any) =>
        item.transcriptPath &&
        item.transcriptStatus === 'COMPLETED' &&
        (!item.braillePath || item.brailleStatus === 'PENDING' 
          || item.brailleStatus === 'FAILED')
      );

      res.json({
        message: `Starting braille backfill for ${candidates.length} items...`,
        total: candidates.length,
      });

      // Process in background — don't block the response
      (async () => {
        const { generateBraille: genBraille } = await import('./services/conversionService');
        let success = 0;
        let failed = 0;

        for (const item of candidates) {
          try {
            // Read the transcript file to get raw text
            const rawTranscriptPath = (item as any).transcriptPath;
            // Normalize: paths stored as "converted/xxx/..." need "uploads/" prefix
            const transcriptRelPath = rawTranscriptPath.startsWith('converted/')
              ? `uploads/${rawTranscriptPath}`
              : rawTranscriptPath.replace(/^.*uploads[\\/]/, 'uploads/');
            const transcriptAbsPath = path.join(
              process.cwd(), transcriptRelPath
            );

            if (!fs.existsSync(transcriptAbsPath)) {
              console.warn(
                `[Backfill] Transcript missing for ${item.id}`
              );
              failed++;
              continue;
            }

            const rawText = fs.readFileSync(transcriptAbsPath, 'utf-8');
            const brailleText = genBraille(rawText);
            const brailleBuffer = Buffer.from(brailleText, 'utf-8');

            // Save braille file next to transcript
            const brailleDir = path.dirname(transcriptAbsPath);
            const brailleLocalPath = path.join(brailleDir, 'braille.brf');
            fs.writeFileSync(brailleLocalPath, brailleBuffer);
            // Match the path format of the transcript (may or may not include uploads/ prefix)
            const braillePath = rawTranscriptPath.replace(/transcript\.txt$/, 'braille.brf');
            await storage.updateContentItem(item.id, {
              braillePath,
              brailleStatus: 'COMPLETED',
            });
            await patchAvailableFormats(
              item.id, 'braille', braillePath, 'COMPLETED'
            );

            console.log(
              `[Backfill] ✅ Braille done: ${item.id} (${item.title})`
            );
            success++;

          } catch (e) {
            console.error(
              `[Backfill] ❌ Failed for ${item.id}:`, e
            );
            await storage.updateContentItem(item.id, {
              brailleStatus: 'FAILED'
            });
            failed++;
          }
        }

        console.log(
          `[Backfill] Complete — ✅ ${success} done, ❌ ${failed} failed`
        );
      })();

    } catch (error: any) {
      console.error('[Backfill] Route error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  return httpServer;
}

