require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const r = await sb.from('classes').select('class_id, class_name, grade_level').order('class_id');
  console.log(r.error ? r.error.message : JSON.stringify(r.data, null, 0));
})();
