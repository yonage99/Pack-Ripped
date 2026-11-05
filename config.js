// Friends & leaderboard server settings (Supabase). See SETUP-FRIENDS.md.
// Both values are meant to be public: the app is protected by the database rules
// in supabase/setup.sql, not by keeping these secret.
window.PACKRIPPED_CONFIG = {
  supabaseUrl: '', // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '', // the "anon public" / "publishable" key
  // Usernames are turned into a placeholder email behind the scenes (no email is ever sent).
  usernameEmailDomain: 'users.packripped.app',
};
