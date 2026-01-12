# Survey Video Manager

A React-based web application for managing survey video uploads with role-based access control, resumable uploads, and offline support.

## 1. Project Overview

### Purpose

Survey Video Manager enables users to upload, track, and manage video files associated with surveys. The system supports hierarchical user roles (admin, manager, surveyor) with different data access levels.

### Key Features

- Resumable video uploads (multipart for files >100MB)
- Offline upload support with automatic resume when connection is restored
- Role-based access control with hierarchical permissions
- Search functionality for surveys
- Progress tracking and error logging
- Video preview integration with external geotagging service

## 2. Architecture

### System Architecture

The application follows a client-side React architecture with:

- **Frontend**: React SPA (Single Page Application) using Vite
- **Backend Services**: Supabase (database, authentication, storage)
- **File Storage**: Cloudflare R2 (via Supabase Edge Functions for signed URLs)
- **Upload Protocol**: AWS S3 multipart upload (compatible with R2) for large files

### Data Flow

1. **Authentication**: User logs in via custom authentication (reads from `users` table)
2. **Survey Loading**: Fetches surveys from Supabase with role-based filtering
3. **Video Upload**:
   - Small files (<100MB): Single PUT request
   - Large files (≥100MB): Multipart upload with 10MB chunks, 4 concurrent parts
   - Progress saved to localStorage for resume capability
4. **Upload Completion**: Creates video record in database, updates survey status

### High-Level Diagram

```
┌─────────────┐
│   Browser   │
│  (React)    │
└──────┬──────┘
       │
       ├─► Supabase (Database: surveys, videos, users, upload_errors)
       │
       ├─► Supabase Edge Function (R2 signed URLs)
       │
       └─► Cloudflare R2 (Video Storage)
```

## 3. Tech Stack

### Core Technologies

- **React 18.3.1**: UI framework
- **Vite 6.0.5**: Build tool and dev server
- **Supabase JS 2.49.4**: Database client and backend services

### State Management

- **Zustand 5.0.8**: Lightweight state management for upload queue
- **React Context API**: Authentication state (`AuthContext`)

### UI & Styling

- **Tailwind CSS 4.1.17**: Utility-first CSS framework
- **Lucide React 0.553.0**: Icon library
- **React Hot Toast 2.5.1**: Toast notifications

### Why Each Technology

- **Vite**: Fast HMR and build times
- **Supabase**: Managed PostgreSQL with real-time capabilities and built-in auth
- **Uppy**: Robust file upload library with resume, progress tracking, and multiple protocol support
- **Zustand**: Simple state management without boilerplate
- **Tailwind**: Rapid UI development with utility classes

## 4. Folder & File Structure

```
survey-video-manager/
├── public/                 # Static assets
│   └── vite.svg
├── src/
│   ├── assets/            # Images, fonts
│   │   └── react.svg
│   ├── components/        # Reusable React components
│   │   ├── Navbar.jsx           # Navigation bar with user info
│   │   ├── ProtectedRoute.jsx   # Route guard for authentication
│   │   ├── VideoUpload.jsx      # Uppy-based upload component (legacy)
│   │   └── VideoUploadResumable.jsx  # Custom resumable upload component
│   ├── contexts/          # React Context providers
│   │   └── AuthContext.jsx      # Authentication state management
│   ├── hooks/             # Custom React hooks
│   │   ├── useNetworkStatus.js  # Network connectivity detection
│   │   └── useUppyWithSupabase.js  # Uppy configuration for Supabase/R2
│   ├── lib/               # Core utilities and configurations
│   │   ├── supabase.js    # Supabase client initialization
│   │   └── store.js       # Zustand store for upload queue
│   ├── pages/             # Page components
│   │   ├── Home.jsx       # Main dashboard with survey list
│   │   └── Login.jsx      # Authentication page
│   ├── styles/            # Component-specific CSS
│   │   ├── Login.css
│   │   ├── Navbar.css
│   │   └── VideoUpload.css
│   ├── App.jsx            # Legacy app component (not used in routing)
│   ├── App.css            # Global app styles
│   ├── index.css          # Base styles
│   └── main.jsx           # Application entry point
├── database_migration.sql # Database schema migration script
├── eslint.config.js       # ESLint configuration
├── index.html             # HTML template
├── package.json           # Dependencies and scripts
├── vite.config.js         # Vite configuration
└── README.md              # This file
```

### Entry Points

- **`src/main.jsx`**: Application entry point, sets up routing and providers
- **`index.html`**: HTML template with root div

### Critical Modules

- **`src/lib/supabase.js`**: Supabase client (used throughout app)
- **`src/contexts/AuthContext.jsx`**: Authentication state (required for protected routes)
- **`src/components/VideoUploadResumable.jsx`**: Core upload functionality

## 5. Core Modules & Components

### AuthContext (`src/contexts/AuthContext.jsx`)

**Purpose**: Manages authentication state across the application.

**Key Responsibilities**:

- Store current user data in localStorage
- Provide login/logout functions
- Expose role-based flags (`isAdmin`, `isManager`, `isSurveyor`)

**Public API**:

- `useAuth()`: Hook to access auth context
- `login(userData)`: Store user and authenticate
- `logout()`: Clear user data
- `user`: Current user object
- `isAuthenticated`: Boolean authentication status

**Internal Logic**:

- Persists user to localStorage on login
- Restores user from localStorage on mount
- Role detection based on `user.role` field

### Home (`src/pages/Home.jsx`)

**Purpose**: Main dashboard displaying surveys with upload capability.

**Key Responsibilities**:

- Fetch and display surveys based on user role
- Provide search functionality
- Handle video upload completion
- Display survey status and metadata

**Key Functions**:

- `fetchSurveys(searchValue)`: Role-based survey fetching
  - Admins: All surveys (limit 100)
  - Managers: Own surveys + surveyor team surveys
  - Surveyors: Own surveys only
- `handleUploadComplete(surveyId, fileName, uploadId)`: Creates video record and updates survey
- `debounce(func, wait)`: Search input debouncing utility

**Interactions**:

- Uses `AuthContext` for role-based queries
- Calls `VideoUploadResumable` for uploads
- Updates Supabase `surveys` and `videos` tables

### VideoUploadResumable (`src/components/VideoUploadResumable.jsx`)

**Purpose**: Handles resumable video uploads with offline support.

**Key Responsibilities**:

- File selection and validation
- Multipart upload orchestration (for files ≥100MB)
- Progress tracking and localStorage persistence
- Network status monitoring and auto-resume

**Key Functions**:

- `handleFileChange(e)`: Validates file and checks for existing upload
- `handleUpload()`: Main upload logic
  - Single PUT for files <100MB
  - Multipart with 4 concurrent chunks for larger files
- `saveUploadProgress()`: Persists upload state to localStorage
- `loadSavedUpload()`: Retrieves saved upload state
- `postEdge(bodyObj)`: Calls Supabase Edge Function for signed URLs

**Upload Flow**:

1. Validate file (size, type, empty check)
2. Check for existing upload in localStorage
3. Get signed URL(s) from Edge Function
4. Upload chunks concurrently (4 at a time)
5. Save progress after each batch
6. Complete multipart upload
7. Call `onUploadComplete` callback

**Interactions**:

- Uses `useNetworkStatus` hook for connectivity
- Calls Supabase Edge Function for R2 signed URLs
- Updates `upload_errors` table on failure

### Login (`src/pages/Login.jsx`)

**Purpose**: User authentication interface.

**Key Responsibilities**:

- Email/password authentication
- Direct database authentication (not Supabase Auth)
- Redirect to home on success

**Internal Logic**:

- Queries `users` table directly
- Compares plaintext password (security consideration)
- Sets user in AuthContext on success

### ProtectedRoute (`src/components/ProtectedRoute.jsx`)

**Purpose**: Route guard ensuring authenticated access.

**Key Responsibilities**:

- Check authentication status
- Redirect to `/login` if not authenticated
- Show loading state during auth check

### useNetworkStatus (`src/hooks/useNetworkStatus.js`)

**Purpose**: Monitor browser network connectivity.

**Returns**: `{ isOnline: boolean }`

**Implementation**: Listens to `online`/`offline` browser events

### useUppyWithSupabase (`src/hooks/useUppyWithSupabase.js`)

**Purpose**: Configure Uppy instance for Supabase/R2 uploads.

**Parameters**:

- `bucketName`: Storage bucket name
- `folder`: Upload folder path
- `surveyId`: Survey identifier for queue management
- `useS3`: Boolean to use S3 multipart (default: true)

**Returns**: Configured Uppy instance

**Configuration**:

- AWS S3 plugin with Edge Function integration
- Multipart threshold: 100MB
- Chunk size: 10MB
- Auto pause/resume on network loss

### Store (`src/lib/store.js`)

**Purpose**: Zustand store for upload queue management.

**State**:

- `queue`: Array of survey IDs in upload queue

**Actions**:

- `addToQueue(surveyId)`: Add survey to queue
- `removeFromQueue(surveyId)`: Remove from queue
- `isUploading(surveyId)`: Check if survey is uploading

## 6. State Management & Data Handling

### State Flow

- **Global Auth State**: `AuthContext` (React Context)
- **Upload Queue**: Zustand store (`src/lib/store.js`)
- **Component State**: React `useState` for local UI state

### API Calls / Services

All database operations use Supabase client:

- **Surveys**: `supabase.from('surveys').select()`
- **Videos**: `supabase.from('videos').insert()`
- **Users**: `supabase.from('users').select()` (login)
- **Upload Errors**: `supabase.from('upload_errors').insert()`

### Caching / Persistence

- **User Session**: localStorage (`user` key)
- **Upload Progress**: localStorage (`resumable_uploads_v2_{surveyId}`)
- **Network Status**: Browser `navigator.onLine` API

### Error Handling Patterns

- Try-catch blocks around async operations
- Toast notifications for user-facing errors (`react-hot-toast`)
- Error logging to `upload_errors` table
- Console error logging for debugging

## 7. Configuration & Environment

### Environment Variables

Required environment variables (set in `.env` file):

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_EDGE_FUNCTION=your_supabase_edge_function_url
VITE_R2_URL=your_r2_cdn_url
```

**Variable Descriptions**:

- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anonymous key (public, safe for client)
- `VITE_EDGE_FUNCTION`: Supabase Edge Function endpoint for R2 signed URLs
- `VITE_R2_URL`: Base URL for R2 CDN (used for video preview URLs)

### Config Files

- **`vite.config.js`**: Vite build configuration with React and Tailwind plugins
- **`eslint.config.js`**: ESLint rules for React and JavaScript

### Build/Runtime Configuration

- **Module Type**: ES modules (`"type": "module"` in package.json)
- **Build Output**: `dist/` directory (configured in Vite)
- **Public Path**: Root (`/`)

### Secrets Handling

- Environment variables prefixed with `VITE_` are exposed to client
- Never commit `.env` files (should be in `.gitignore`)
- Use Supabase RLS (Row Level Security) for data protection
- Edge Function handles R2 credentials server-side

## 8. Setup & Installation

### Prerequisites

- Node.js 18+ and npm
- Supabase project with configured database
- Supabase Edge Function for R2 signed URLs
- Cloudflare R2 bucket (or S3-compatible storage)

### Installation Steps

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd survey-video-manager
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:

   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_EDGE_FUNCTION=https://your-project.supabase.co/functions/v1/your-function
   VITE_R2_URL=https://your-r2-cdn-url.com
   ```

4. **Run database migration**
   Execute `database_migration.sql` in your Supabase SQL editor to ensure the `surveys` table has a `user_id` column.

5. **Start development server**

   ```bash
   npm run dev
   ```

6. **Access the application**
   Open `http://localhost:5173` (or the port shown in terminal)

### Build and Production Steps

1. **Build for production**

   ```bash
   npm run build
   ```

2. **Preview production build**

   ```bash
   npm run preview
   ```

3. **Deploy**
   - Build output is in `dist/` directory
   - Deploy `dist/` contents to static hosting (Vercel, Netlify, etc.)
   - Ensure environment variables are set in hosting platform

## 9. Scripts & Commands

### Available Scripts

- **`npm run dev`**: Start Vite development server with HMR

  - Runs on `http://localhost:5173` by default
  - Hot module replacement enabled

- **`npm run build`**: Build for production

  - Outputs optimized bundle to `dist/`
  - Minifies and tree-shakes code
  - Generates production-ready assets

- **`npm run lint`**: Run ESLint

  - Checks all `.js` and `.jsx` files
  - Uses React-specific rules
  - Reports errors and warnings

- **`npm run preview`**: Preview production build locally
  - Serves `dist/` directory
  - Tests production build before deployment

## 10. Testing

### Testing Strategy

Currently, no automated tests are configured. The application relies on manual testing.

### Test Structure

N/A (no test files present)

### How to Run Tests

N/A

### Coverage

N/A

## 11. Glossary

### Domain Terms

- **Survey**: A data collection record with associated metadata (name, timestamp, GPS tracks, videos)
- **Video**: A video file associated with a survey, stored in R2
- **Upload ID**: Identifier for a multipart upload session (used for resuming)
- **Chunk**: A portion of a file (10MB) uploaded as part of multipart upload
- **Multipart Upload**: AWS S3-compatible upload protocol for large files, splits file into parts

### Abbreviations

- **SPA**: Single Page Application
- **HMR**: Hot Module Replacement
- **RLS**: Row Level Security (Supabase feature)
- **R2**: Cloudflare R2 (S3-compatible object storage)
- **TUS**: Resumable Upload Protocol (not currently used)
- **CDN**: Content Delivery Network
- **ETag**: Entity tag, used for multipart upload part verification

### Technical Terms

- **Edge Function**: Supabase serverless function for backend operations
- **Signed URL**: Time-limited URL with authentication for direct uploads
- **Zustand**: Lightweight state management library
- **Uppy**: File upload library with multiple protocol support
- **Debounce**: Delay function execution until after a period of inactivity
