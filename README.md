# Accessible Education V3

A comprehensive web application for accessible education with support for multiple content formats, accessibility features, and role-based access control.

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm
- PostgreSQL database (Neon recommended)
- Azure Storage account (for content conversion)
- Google Gemini API key

### Setup Instructions

1. **Clone the repository**
   ```bash
   git clone https://github.com/rameshtavishwakarma97-design/Accessible-Education-V2.git
   cd Accessible-Education-V2
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   - Copy `.env.example` to `.env`
   - Fill in the required credentials:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` with your actual secrets:
     - `DATABASE_URL`: PostgreSQL connection string (get from Neon)
     - `AZURE_STORAGE_CONNECTION_STRING`: Azure Storage connection string
     - `AZURE_BLOB_CONTAINER`: Azure container name (usually "content")
     - `GEMINI_API_KEY`: Google Gemini API key

4. **Initialize the database**
   ```bash
   npm run build
   # Database migrations will run automatically on server start
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

   The application will be available at `http://localhost:54321`

## Getting Required Credentials

### Database (Neon)
1. Sign up at https://neon.tech
2. Create a project and database
3. Copy the connection string to `DATABASE_URL`

### Azure Storage
1. Create an Azure Storage Account
2. Go to Access Keys in Azure Portal
3. Copy the connection string to `AZURE_STORAGE_CONNECTION_STRING`
4. Create a blob container named "content"

### Google Gemini API
1. Visit https://console.cloud.google.com
2. Enable the Generative AI API
3. Create an API key
4. Copy to `GEMINI_API_KEY`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Run production build
- `npm run check` - Run TypeScript type checking

## Project Structure

```
├── client/              # React frontend
│   └── src/
│       ├── components/  # Reusable components
│       ├── pages/       # Page components
│       └── lib/         # Utilities and hooks
├── server/              # Express backend
│   ├── routes.ts       # API routes
│   ├── storage.ts      # Database operations
│   ├── auth.ts         # Authentication logic
│   └── services/       # External service integrations
├── shared/              # Shared types and schemas
└── script/              # Build scripts
```

## Key Features

- **Accessibility First**: Support for multiple content formats (PDF, video, audio, transcripts, braille, etc.)
- **Role-Based Access**: Student, Teacher, Admin, and Institute Admin roles
- **Content Management**: Upload, convert, and manage educational content
- **Assessments**: Create and take assessments with progress tracking
- **Real-time Messaging**: Thread-based communication system
- **Analytics**: Admin dashboard with usage analytics
- **Text-to-Speech**: Kokoro TTS integration for audio content

## Contributing

1. Create a branch for your feature: `git checkout -b feature/your-feature`
2. Make your changes and ensure all tests pass: `npm run check`
3. Commit with a clear message
4. Push to GitHub and create a pull request

## Important Notes

⚠️ **Never commit `.env` files to version control**
- Always use `.env.example` to document required variables
- Ask teammates for credential values privately
- Each developer should have their own local `.env` file

## Support

For issues or questions, please reach out to the team or create an issue on GitHub.

## License

MIT
