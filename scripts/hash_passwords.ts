import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('Bắt đầu quét bảng users...');
  
  // Lấy tất cả người dùng
  const { data: users, error } = await supabase
    .from('users')
    .select('user_id, email, password');
    
  if (error) {
    console.error('Lỗi khi lấy danh sách users:', error);
    process.exit(1);
  }

  console.log(`Tìm thấy ${users.length} người dùng.`);

  let updatedCount = 0;

  for (const user of users) {
    let rawPassword = user.password;
    
    // Nếu password null hoặc rỗng, gán mặc định là 123456
    if (!rawPassword) {
      rawPassword = '123456';
    }

    // Nếu mật khẩu chưa được băm (bcrypt hash luôn bắt đầu bằng $2)
    if (!rawPassword.startsWith('$2b$') && !rawPassword.startsWith('$2a$') && !rawPassword.startsWith('$2y$')) {
      console.log(`Đang mã hóa mật khẩu cho user: ${user.email} (ID: ${user.user_id})`);
      
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      
      const { error: updateError } = await supabase
        .from('users')
        .update({ password: hashedPassword })
        .eq('user_id', user.user_id);
        
      if (updateError) {
        console.error(`Lỗi cập nhật user ${user.user_id}:`, updateError);
      } else {
        updatedCount++;
      }
    }
  }

  console.log(`Hoàn thành! Đã mã hóa mật khẩu cho ${updatedCount} người dùng.`);
}

runMigration().catch(console.error);
