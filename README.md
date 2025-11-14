 # React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.
      
Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh
    
# Survey Video Manager  

This application allows users to manage survey videos with role-based access control.
 
## Login System Implementation 
 
The application now uses a custom login system that authenticates against the `users` table in Supabase without using Supabase Auth. The system includes:

1. A login page where users enter their email and password
2. Role-based access control (admin, manager, surveyor)
3. Authentication state persistence using localStorage
4. Protected routes that redirect to login if not authenticated

## Database Schema

The users table follows this schema:

```sql
create table public.users (
  user_id uuid not null default gen_random_uuid(),
  username text not null,
  email text not null,
  role text not null,
  location text null,
  manager_id uuid null,
  password text null,
  constraint users_pkey primary key (user_id),
  constraint users_email_key unique (email),
  constraint users_manager_id_fkey foreign KEY (manager_id) references users (user_id),
  constraint users_role_check check (
    (
      role = any (
        array['admin'::text, 'manager'::text, 'surveyor'::text]
      )
    )
  )
)
```

## Role-Based Content Filtering

The application filters content based on user roles:
- Admins see all surveys
- Managers see their own surveys and surveys from surveyors they manage
- Surveyors see only their own surveys

## Setup Instructions

1. Create the `users` table in your Supabase database using the schema above
2. Make sure your `surveys` table has a `user_id` column that references `users.user_id`
3. Populate the `users` table with test users (at minimum add one admin)
4. Update existing surveys to associate them with users by setting the `user_id` column

### Example SQL to create test users:

```sql
INSERT INTO public.users (username, email, role, password) 
VALUES 
  ('Admin User', 'admin@example.com', 'admin', 'password123'),
  ('Manager User', 'manager@example.com', 'manager', 'password123'),
  ('Surveyor User', 'surveyor@example.com', 'surveyor', 'password123');

-- Set the manager_id for the surveyor (assuming the manager's user_id)
UPDATE public.users 
SET manager_id = (SELECT user_id FROM public.users WHERE email = 'manager@example.com')
WHERE email = 'surveyor@example.com';..
```

**IMPORTANT**: This implementation uses plain text passwords for simplicity. In a production environment, you should hash passwords and implement proper security measures.
