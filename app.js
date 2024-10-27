import express from 'express';
import pg from 'pg';
import bodyParser from 'body-parser';
import session from 'express-session';
import path from 'path'; // เพิ่มการนำเข้าโมดูล path
import cors from 'cors';
import {fileURLToPath} from 'url';

const app = express();
const router = express.Router(); // สร้าง router ใหม่
const { Pool } = pg;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));

// PostgreSQL connection
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'project1',
    password: '1',
    port: 5432,
});

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Middleware
app.use(cors());
app.use(bodyParser.json()); 

// Static folder to serve HTML
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.static('public'));

// กำหนดไดเรกทอรีสำหรับ views
app.set('views', path.join(__dirname, 'views'));

// Route สำหรับหน้า student
app.get('/student', (req, res) => {
    res.render('login'); // ชื่อไฟล์ student.ejs
});

//Home
app.get('/Home', async (req,res) => {
    res.render('Home');
})

app.get('/std', async (req, res) => {
    const searchQuery = req.query.search; // ดึงข้อมูลการค้นหาจาก query string
    let query = `
        SELECT s.id, s.first_name, s.last_name, s.date_of_birth, c.short_name_en AS curriculum, s.email
        FROM student s
        JOIN curriculum c ON s.curriculum_id = c.id
    `;
    let queryParams = [];

    if (searchQuery) {
        query += ' WHERE s.id::text ILIKE $1 OR s.first_name ILIKE $1 OR s.last_name ILIKE $1 OR c.short_name_en ILIKE $1 OR s.email ILIKE $1';  // ใช้ ILIKE เพื่อให้ค้นหาไม่สนใจตัวพิมพ์เล็กใหญ่
        queryParams.push(`%${searchQuery}%`);
    }

    try {
        const students = await pool.query(query, queryParams);
        
        // ส่งข้อมูลไปยัง std.ejs
        res.render('std', { students: students.rows });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/std', async (req, res) => {
    try {
        const section_id = req.body.section_id; // รับค่า section_id
        const checkedStudents = [];

        // Loop through the request body to get the status for each student
        for (const key in req.body) {
            if (key.startsWith('status_')) {
                const studentId = key.split('_')[1]; // Extract student ID from the form field name
                const status = req.body[key]; // Get the status value (P/N)

                // Save to student_list table
                await pool.query(
                    'INSERT INTO student_list (student_id, section_id, active_date, status) VALUES ($1, $2, CURRENT_DATE, $3) ON CONFLICT (student_id, section_id) DO UPDATE SET active_date = CURRENT_DATE, status = EXCLUDED.status',
                    [studentId, section_id, status]
                );
            }
        }

        res.redirect('/check'); // Redirect to check page after saving
    } catch (error) {
        console.error('Error saving attendance:', error);
        res.status(500).send('Error saving attendance');
    }
});

app.get('/check', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.first_name, s.last_name, sl.section_id, sl.active_date, sl.status
            FROM student_list sl
            JOIN student s ON sl.student_id = s.id
            ORDER BY sl.active_date DESC
        `);

        res.render('check', { attendanceRecords: result.rows });
    } catch (error) {
        console.error('Error fetching attendance records:', error);
        res.status(500).send('Error fetching attendance records');
    }
});


app.post('/check', async (req, res) => {
    const checkedStudents = [];
    const sectionId = req.body.section_id; // ถ้าต้องการให้มีการส่ง section_id 

    // ดึงข้อมูลนักเรียนทั้งหมดจากฐานข้อมูล
    const studentsQuery = await pool.query('SELECT * FROM student');
    const studentsData = studentsQuery.rows;

    // ตรวจสอบว่ามีข้อมูลจากฟอร์ม
    for (const key in req.body) {
        if (req.body.hasOwnProperty(key) && key.startsWith('status_')) {
            const studentId = key.split('_')[1]; // ดึง id ของนักเรียน
            const status = req.body[key]; // รับค่าที่ส่งมาจากปุ่ม

            // ค้นหานักเรียนที่เกี่ยวข้อง
            const studentInfo = studentsData.find(student => student.id === parseInt(studentId));

            if (studentInfo) {
                checkedStudents.push({ 
                    studentId: studentInfo.id,
                    first_name: studentInfo.first_name,
                    last_name: studentInfo.last_name,
                    date_of_birth: studentInfo.date_of_birth,
                    curriculum_id: studentInfo.curriculum_id,
                    email: studentInfo.email,
                    status 
                });
                
                // บันทึกข้อมูลสถานะนักเรียนใน student_list
                await pool.query(
                    'INSERT INTO student_list (section_id, student_id, active_date, status) VALUES ($1, $2, $3, $4)', 
                    [sectionId, studentInfo.id, new Date(), status]
                );
            }
        }
    }

    // ส่งข้อมูลไปยังหน้า check.ejs
    res.render('check', { students: checkedStudents });
});

// Route สำหรับแสดงหน้าฟอร์มแก้ไขข้อมูล
app.get('/edit/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM student WHERE id = $1', [id]);
        const student = result.rows[0];
        res.render('edit', { student }); // ส่งข้อมูล student ไปยังหน้า edit.ejs
    } catch (error) {
        console.error('Error fetching student:', error);
        res.status(500).send('Error fetching student');
    }
});

// Route สำหรับบันทึกข้อมูลที่แก้ไขแล้ว
app.post('/update/:id', async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, email } = req.body; // ค่า field ที่จะแก้ไข
    try {
        await pool.query(
            'UPDATE student SET first_name = $1, last_name = $2, email = $3 WHERE id = $4',
            [first_name, last_name, email, id]
        );
        res.redirect('/std'); // กลับไปที่หน้ารายชื่อนักเรียนหลังจากแก้ไขเสร็จ
    } catch (error) {
        console.error('Error updating student:', error);
        res.status(500).send('Error updating student');
    }
});

// Route สำหรับการเพิ่มข้อมูลนักเรียน
app.post('/students', async (req, res) => {
    const { prefix_id, first_name, last_name, date_of_birth, curriculum_id, previous_school, address, telephone, email, line_id } = req.body;

    try {
        await pool.query('INSERT INTO student (prefix_id, first_name, last_name, date_of_birth, curriculum_id, previous_school, address, telephone, email, line_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', 
        [prefix_id, first_name, last_name, date_of_birth, curriculum_id, previous_school, address, telephone, email, line_id]);
        
        res.redirect('/students'); // Redirect ไปยังหน้าข้อมูลนักเรียน
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
console.log(prefix_id)
});

app.get('/login', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM student'); // แทนที่ 'std' ด้วยชื่อตารางของคุณ
        res.render('login', { users: result.rows }); // ส่งข้อมูลไปยังไฟล์ EJS
    } catch (error) {
        console.error('Error executing query', error.stack);
        res.status(500).send('Server Error');
    }
});

app.get('/student', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM student'); // ดึงข้อมูลจากตาราง std
        res.render('student', { users: result.rows }); // ส่งผลลัพธ์ไปยัง std.ejs
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/check-in', async (req, res) => {
    const checkedStudents = [];
    
    // ดึงข้อมูลนักเรียนทั้งหมดจากฐานข้อมูล
    const studentsQuery = await pool.query('SELECT * FROM student');
    const studentsData = studentsQuery.rows;

    // ตรวจสอบว่ามีข้อมูลจากฟอร์ม
    for (const key in req.body) {
        if (req.body.hasOwnProperty(key)) {
            const studentId = key.split('_')[1]; // ดึง id ของนักเรียน
            const status = req.body[key] ? 'มา' : 'ไม่มา'; // กำหนดสถานะ

            // ค้นหานักเรียนที่เกี่ยวข้อง
            const studentInfo = studentsData.find(student => student.id === parseInt(studentId));

            if (studentInfo) {
                checkedStudents.push({ 
                    studentId: studentInfo.id,
                    first_name: studentInfo.first_name,
                    last_name: studentInfo.last_name,
                    date_of_birth: studentInfo.date_of_birth,
                    curriculum_id: studentInfo.curriculum_id,
                    email: studentInfo.email,
                    status 
                });
                
                // บันทึกข้อมูลสถานะนักเรียน
                await pool.query('INSERT INTO student_list (student_id, active_date, status) VALUES ($1, $2, $3)', 
                [studentInfo.id, new Date(), status]);
            }
        }
    }

    // ส่งข้อมูลไปยังหน้า check.ejs
    res.render('check', { students: checkedStudents });
});


app.post('/users', (req, res) => {
    const { name, age, email } = req.body;
  
    // คำสั่ง SQL สำหรับเพิ่มข้อมูลลงในตาราง std
    const sql = 'INSERT INTO student (name, age, email) VALUES ($1, $2, $3)';
    const values = [name, age, email];
  
    pool.query(sql, values, (error, result) => {
      if (error) {
        console.error('Error executing query', error.stack);
        res.status(500).send('Error inserting data');
      } else {
        res.send('เพิ่มข้อมูลในตารางแล้ว');
      }
    });
  });

// Middleware for session-based authentication
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
}));


// หน้า login 
app.get('/index', (req, res) => {
    res.render('index');
});

// Handle login
app.post('/index', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Query to find the user by username
        const userQuery = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

        if (userQuery.rows.length > 0) {
            const user = userQuery.rows[0];

            // Check if the password matches (no hashing)
            if (password === user.password_hash) {
                req.session.userId = user.user_id; // Store user ID in session
                res.redirect('/Home'); // หลังจาก Login เสร็จจะมาหน้านี้---------------------------------->
            } else {
                res.render('index', { error: 'Invalid username or password' });
            }
        } else {
            res.render('index', { error: 'Invalid username or password' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// Home route for rendering login permissions
app.get('/login', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/index'); // Redirect to login page if not logged in
    }

    const userId = req.session.userId;

    // Example query for permissions; update as needed
    const userPermissionsQuery = `
        SELECT r.resource_name, p.permission_name
        FROM acl a
        JOIN resources r ON a.resource_id = r.resource_id
        JOIN permissions p ON a.permission_id = p.permission_id
        WHERE a.user_id = $1;
    `;

    const permissions = await pool.query(userPermissionsQuery, [userId]);

    // Render the login page with user permissions
    res.render('login', { permissions: permissions.rows }); // Make sure login.ejs is set up correctly
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/index'); // Redirect to home page after logout
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static folder to serve HTML
app.use(express.static(path.join(process.cwd(), 'public'))); // ใช้ process.cwd() เพื่อให้แน่ใจว่า path ถูกต้อง

// Define the port
const PORT = process.env.PORT || 3000;

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

export default router; 