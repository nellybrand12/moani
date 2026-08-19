-- AddColumn profilePicture to users table with WhatsApp-style default
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profilePicture" TEXT DEFAULT 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png';
