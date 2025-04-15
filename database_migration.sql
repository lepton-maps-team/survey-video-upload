-- This file contains the SQL commands to update your database schema
-- If the surveys table doesn't already have a user_id column, you'll need to add it

-- Check if user_id column exists, if not add it
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'surveys' 
        AND column_name = 'user_id'
    ) THEN
        ALTER TABLE public.surveys 
        ADD COLUMN user_id UUID REFERENCES public.users(user_id);
    END IF;
END $$;

-- After adding the column, you'll need to populate it with existing data
-- This is just an example, adjust it based on your actual needs:
-- UPDATE public.surveys 
-- SET user_id = (SELECT user_id FROM public.users WHERE role = 'admin' LIMIT 1)
-- WHERE user_id IS NULL;

-- Make sure all surveys have a user_id (optional, depends on your business logic)
-- ALTER TABLE public.surveys ALTER COLUMN user_id SET NOT NULL;

-- Remember to update RLS policies if you're using them
-- Example:
-- ALTER POLICY "Surveys are viewable by owner" ON surveys 
-- USING (auth.uid() = user_id); 