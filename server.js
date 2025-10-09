const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
//app.use(express.static(path.join(__dirname)));

// Database configuration
const dbConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'jsjlinkup',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_HOST && process.env.DB_HOST.includes('rds.amazonaws.com') ? { 
    rejectUnauthorized: false 
  } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool(dbConfig);

// Test database connection
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, current_database() as db_name');
    console.log('✅ Successfully connected to database');
    console.log(`🏠 Host: ${dbConfig.host}`);
    console.log(`🗃️ Database: ${result.rows[0].db_name}`);
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Simple session storage
const activeSessions = new Map();
const activeAdminSessions = new Map();

// Authentication middleware
const authenticateStudent = (req, res, next) => {
  const sessionId = req.headers['authorization'] || req.headers['session-id'];
  if (!sessionId) {
    return res.status(401).json({ error: 'Session ID required' });
  }
  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  req.user = session;
  next();
};

const authenticateAdmin = (req, res, next) => {
  const sessionId = req.headers['authorization'] || req.headers['session-id'];
  if (!sessionId) {
    return res.status(401).json({ error: 'Session ID required' });
  }
  const session = activeAdminSessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid admin session' });
  }
  req.admin = session;
  next();
};

// ==================== INITIALIZATION ====================
app.post('/api/init-db', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create all tables
    const tables = [
      `CREATE TABLE IF NOT EXISTS campuses (
        id SERIAL PRIMARY KEY,
        campus_name VARCHAR(100) NOT NULL,
        location VARCHAR(200) NOT NULL,
        campus_size DECIMAL(10,2)
      )`,
      `CREATE TABLE IF NOT EXISTS faculty (
        id SERIAL PRIMARY KEY,
        faculty_name VARCHAR(150) NOT NULL UNIQUE,
        office_address TEXT,
        description TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        faculty_id INTEGER REFERENCES faculty(id),
        course_name VARCHAR(200) NOT NULL,
        credits INTEGER NOT NULL CHECK (credits > 0),
        number_of_modules INTEGER NOT NULL CHECK (number_of_modules > 0),
        course_code VARCHAR(20) NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        module_name VARCHAR(200) NOT NULL,
        module_code VARCHAR(20) NOT NULL UNIQUE,
        credits INTEGER NOT NULL CHECK (credits > 0),
        module_cost DECIMAL(10,2) CHECK (module_cost >= 0)
      )`,
      `CREATE TABLE IF NOT EXISTS students (
        student_number VARCHAR(9) PRIMARY KEY CHECK (student_number ~ '^[0-9]{9}$'),
        name VARCHAR(100) NOT NULL,
        surname VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
        password VARCHAR(255) NOT NULL,
        course_id INTEGER REFERENCES courses(id),
        year_of_study VARCHAR(20) NOT NULL CHECK (year_of_study IN ('first year', 'second year', 'third year', 'fourth year', 'postgrad')),
        faculty_id INTEGER REFERENCES faculty(id),
        campus_id INTEGER REFERENCES campuses(id),
        phone_number VARCHAR(20)
      )`,
      `CREATE TABLE IF NOT EXISTS admin (
        admin_id SERIAL PRIMARY KEY,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
        name VARCHAR(100) NOT NULL,
        surname VARCHAR(100) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        group_name VARCHAR(100) NOT NULL,
        group_description TEXT,
        group_size INTEGER DEFAULT 0 CHECK (group_size >= 0),
        max_size INTEGER NOT NULL CHECK (max_size > 0),
        created_by VARCHAR(9) REFERENCES students(student_number),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (group_size <= max_size)
      )`,
      `CREATE TABLE IF NOT EXISTS links (
        id SERIAL PRIMARY KEY,
        connector VARCHAR(9) NOT NULL REFERENCES students(student_number),
        acceptor VARCHAR(9) NOT NULL REFERENCES students(student_number),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (connector != acceptor)
      )`,
      `CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        location VARCHAR(200) NOT NULL,
        event_datetime TIMESTAMP NOT NULL,
        created_by VARCHAR(9) REFERENCES students(student_number)
      )`,
      `CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        class_name VARCHAR(100) NOT NULL,
        module_id INTEGER REFERENCES modules(id),
        class_time TIME NOT NULL,
        class_date DATE NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        location VARCHAR(200) NOT NULL,
        instructor VARCHAR(100) NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS student_classes (
        student_number VARCHAR(9) REFERENCES students(student_number),
        class_id INTEGER REFERENCES classes(id),
        PRIMARY KEY (student_number, class_id)
      )`,
      `CREATE TABLE IF NOT EXISTS badges (
        id SERIAL PRIMARY KEY,
        badge_name VARCHAR(100) NOT NULL,
        description TEXT,
        student_number VARCHAR(9) NOT NULL REFERENCES students(student_number),
        awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        caption TEXT,
        created_by VARCHAR(9) NOT NULL REFERENCES students(student_number),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('student', 'admin')),
        target_student VARCHAR(9) REFERENCES students(student_number),
        target_admin INTEGER REFERENCES admin(admin_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (
          (target_type = 'student' AND target_student IS NOT NULL AND target_admin IS NULL) OR
          (target_type = 'admin' AND target_admin IS NOT NULL AND target_student IS NULL)
        )
      )`,
      `CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        rator_type VARCHAR(10) NOT NULL CHECK (rator_type IN ('student', 'admin')),
        rator_student VARCHAR(9) REFERENCES students(student_number),
        rator_admin INTEGER REFERENCES admin(admin_id),
        rating_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rating_value INTEGER NOT NULL CHECK (rating_value >= 0 AND rating_value <= 5),
        rating_description TEXT,
        CHECK (
          (rator_type = 'student' AND rator_student IS NOT NULL AND rator_admin IS NULL) OR
          (rator_type = 'admin' AND rator_admin IS NOT NULL AND rator_student IS NULL)
        )
      )`,
      `CREATE TABLE IF NOT EXISTS course_modules (
        course_id INTEGER REFERENCES courses(id),
        module_id INTEGER REFERENCES modules(id),
        PRIMARY KEY (course_id, module_id)
      )`,
      `CREATE TABLE IF NOT EXISTS likes (
        id SERIAL PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id),
        student_number VARCHAR(9) REFERENCES students(student_number),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, student_number)
      )`
    ];

    // Execute all table creation queries
    for (const tableQuery of tables) {
      await client.query(tableQuery);
    }

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_students_email ON students(email)',
      'CREATE INDEX IF NOT EXISTS idx_students_course_id ON students(course_id)',
      'CREATE INDEX IF NOT EXISTS idx_students_campus_id ON students(campus_id)',
      'CREATE INDEX IF NOT EXISTS idx_links_connector ON links(connector)',
      'CREATE INDEX IF NOT EXISTS idx_links_acceptor ON links(acceptor)',
      'CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_events_datetime ON events(event_datetime)',
      'CREATE INDEX IF NOT EXISTS idx_classes_datetime ON classes(class_date, class_time)',
      'CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_student, target_admin)',
      'CREATE INDEX IF NOT EXISTS idx_ratings_rator ON ratings(rator_student, rator_admin)',
      'CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id)'
    ];

    for (const indexQuery of indexes) {
      await client.query(indexQuery);
    }

    // Insert sample data
    await client.query(`
      INSERT INTO campuses (id, campus_name, location, campus_size) 
      VALUES 
        (1, 'Main Campus', '123 University Ave, Johannesburg', 50.5),
        (2, 'City Campus', '456 Downtown St, Johannesburg', 25.3),
        (3, 'Science Campus', '789 Research Park, Johannesburg', 35.7)
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO faculty (id, faculty_name, office_address, description) 
      VALUES 
        (1, 'Faculty of Science', 'Science Building, Room 101', 'Science and Technology programs'),
        (2, 'Faculty of Arts', 'Arts Building, Room 201', 'Humanities and Arts programs'),
        (3, 'Faculty of Engineering', 'Engineering Building, Room 301', 'Engineering and Technology programs'),
        (4, 'Faculty of Business', 'Business Building, Room 401', 'Business and Management programs')
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO courses (id, faculty_id, course_name, credits, number_of_modules, course_code) 
      VALUES 
        (1, 1, 'Computer Science', 120, 8, 'CS101'),
        (2, 1, 'Information Technology', 120, 8, 'IT101'),
        (3, 2, 'Business Administration', 120, 8, 'BA101'),
        (4, 3, 'Electrical Engineering', 140, 10, 'EE101'),
        (5, 4, 'Accounting', 120, 8, 'ACC101')
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO modules (id, module_name, module_code, credits, module_cost) 
      VALUES 
        (1, 'Introduction to Programming', 'CS101', 15, 1500.00),
        (2, 'Database Systems', 'CS102', 15, 1600.00),
        (3, 'Web Development', 'CS103', 15, 1700.00),
        (4, 'Business Management', 'BA101', 15, 1400.00),
        (5, 'Financial Accounting', 'ACC101', 15, 1550.00)
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO course_modules (course_id, module_id) 
      VALUES 
        (1, 1), (1, 2), (1, 3),
        (3, 4), (5, 5)
      ON CONFLICT DO NOTHING
    `);

    // Create default admin
    const hashedAdminPassword = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO admin (admin_id, password, email, name, surname) 
      VALUES (1, $1, 'admin@jsjlinkup.com', 'System', 'Administrator')
      ON CONFLICT (admin_id) DO NOTHING
    `, [hashedAdminPassword]);

    await client.query('COMMIT');
    res.json({ message: 'Database initialized successfully with all tables and sample data' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Init DB error:', error);
    res.status(500).json({ error: 'Failed to initialize database: ' + error.message });
  } finally {
    client.release();
  }
});

// ==================== AUTHENTICATION ROUTES ====================
app.post('/api/register', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const {
      student_number,
      name,
      surname,
      email,
      password,
      course_id,
      year_of_study,
      faculty_id,
      campus_id,
      phone_number
    } = req.body;

    if (!student_number || !name || !surname || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await client.query(
      `INSERT INTO students (student_number, name, surname, email, password, course_id, year_of_study, faculty_id, campus_id, phone_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING student_number, name, surname, email, year_of_study, phone_number`,
      [student_number, name, surname, email, hashedPassword, course_id, year_of_study, faculty_id, campus_id, phone_number]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Student registered successfully',
      student: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      res.status(400).json({ error: 'Student number or email already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
  } finally {
    client.release();
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query(
      `SELECT student_number, name, surname, email, password FROM students WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const student = result.rows[0];
    const validPassword = await bcrypt.compare(password, student.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sessionId = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    activeSessions.set(sessionId, {
      student_number: student.student_number,
      email: student.email,
      name: student.name,
      surname: student.surname
    });

    setTimeout(() => activeSessions.delete(sessionId), 24 * 60 * 60 * 1000);

    res.json({
      message: 'Login successful',
      sessionId: sessionId,
      student: {
        student_number: student.student_number,
        name: student.name,
        surname: student.surname,
        email: student.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query(
      `SELECT admin_id, name, surname, email, password FROM admin WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sessionId = `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    activeAdminSessions.set(sessionId, {
      admin_id: admin.admin_id,
      email: admin.email,
      name: admin.name,
      surname: admin.surname
    });

    setTimeout(() => activeAdminSessions.delete(sessionId), 24 * 60 * 60 * 1000);

    res.json({
      message: 'Admin login successful',
      sessionId: sessionId,
      admin: {
        admin_id: admin.admin_id,
        name: admin.name,
        surname: admin.surname,
        email: admin.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/logout', (req, res) => {
  const sessionId = req.headers['authorization'] || req.headers['session-id'];
  if (sessionId) {
    activeSessions.delete(sessionId);
    activeAdminSessions.delete(sessionId);
  }
  res.json({ message: 'Logout successful' });
});

// ==================== CAMPUSES ROUTES ====================
app.get('/api/campuses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM campuses ORDER BY campus_name');
    res.json({ campuses: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/campuses', authenticateAdmin, async (req, res) => {
  try {
    const { campus_name, location, campus_size } = req.body;
    const result = await pool.query(
      'INSERT INTO campuses (campus_name, location, campus_size) VALUES ($1, $2, $3) RETURNING *',
      [campus_name, location, campus_size]
    );
    res.status(201).json({ message: 'Campus created', campus: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.put('/api/campuses/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { campus_name, location, campus_size } = req.body;
    const result = await pool.query(
      'UPDATE campuses SET campus_name = $1, location = $2, campus_size = $3 WHERE id = $4 RETURNING *',
      [campus_name, location, campus_size, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campus not found' });
    }
    res.json({ message: 'Campus updated', campus: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.delete('/api/campuses/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM campuses WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campus not found' });
    }
    res.json({ message: 'Campus deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== FACULTY ROUTES ====================
app.get('/api/faculties', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM faculty ORDER BY faculty_name');
    res.json({ faculties: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/faculties', authenticateAdmin, async (req, res) => {
  try {
    const { faculty_name, office_address, description } = req.body;
    const result = await pool.query(
      'INSERT INTO faculty (faculty_name, office_address, description) VALUES ($1, $2, $3) RETURNING *',
      [faculty_name, office_address, description]
    );
    res.status(201).json({ message: 'Faculty created', faculty: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== COURSES ROUTES ====================
app.get('/api/courses', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, f.faculty_name 
      FROM courses c 
      LEFT JOIN faculty f ON c.faculty_id = f.id 
      ORDER BY c.course_name`
    );
    res.json({ courses: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.get('/api/faculties/:facultyId/courses', async (req, res) => {
  try {
    const { facultyId } = req.params;
    const result = await pool.query(
      'SELECT * FROM courses WHERE faculty_id = $1 ORDER BY course_name',
      [facultyId]
    );
    res.json({ courses: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/courses', authenticateAdmin, async (req, res) => {
  try {
    const { faculty_id, course_name, credits, number_of_modules, course_code } = req.body;
    const result = await pool.query(
      'INSERT INTO courses (faculty_id, course_name, credits, number_of_modules, course_code) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [faculty_id, course_name, credits, number_of_modules, course_code]
    );
    res.status(201).json({ message: 'Course created', course: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== MODULES ROUTES ====================
app.get('/api/modules', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM modules ORDER BY module_name');
    res.json({ modules: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/modules', authenticateAdmin, async (req, res) => {
  try {
    const { module_name, module_code, credits, module_cost } = req.body;
    const result = await pool.query(
      'INSERT INTO modules (module_name, module_code, credits, module_cost) VALUES ($1, $2, $3, $4) RETURNING *',
      [module_name, module_code, credits, module_cost]
    );
    res.status(201).json({ message: 'Module created', module: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== STUDENTS ROUTES ====================
app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.course_name, f.faculty_name, camp.campus_name
      FROM students s
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN faculty f ON s.faculty_id = f.id
      LEFT JOIN campuses camp ON s.campus_id = camp.id
      ORDER BY s.student_number`
    );
    res.json({ students: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.get('/api/students/:student_number', async (req, res) => {
  try {
    const { student_number } = req.params;
    const result = await pool.query(`
      SELECT s.*, c.course_name, f.faculty_name, camp.campus_name
      FROM students s
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN faculty f ON s.faculty_id = f.id
      LEFT JOIN campuses camp ON s.campus_id = camp.id
      WHERE s.student_number = $1`,
      [student_number]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const student = result.rows[0];
    delete student.password;
    res.json({ student });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.put('/api/students/:student_number', authenticateStudent, async (req, res) => {
  try {
    const { student_number } = req.params;
    const { name, surname, email, phone_number, year_of_study } = req.body;
    
    // Students can only update their own profile
    if (req.user.student_number !== student_number) {
      return res.status(403).json({ error: 'Cannot update other student profiles' });
    }

    const result = await pool.query(
      `UPDATE students SET name = $1, surname = $2, email = $3, phone_number = $4, year_of_study = $5 
       WHERE student_number = $6 RETURNING student_number, name, surname, email, phone_number, year_of_study`,
      [name, surname, email, phone_number, year_of_study, student_number]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ message: 'Student updated successfully', student: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.delete('/api/students/:student_number', authenticateAdmin, async (req, res) => {
  try {
    const { student_number } = req.params;
    const result = await pool.query('DELETE FROM students WHERE student_number = $1 RETURNING student_number', [student_number]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== GROUPS ROUTES ====================
app.get('/api/groups', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, s.name as creator_name, s.surname as creator_surname
      FROM groups g
      LEFT JOIN students s ON g.created_by = s.student_number
      ORDER BY g.created_at DESC`
    );
    res.json({ groups: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/groups', authenticateStudent, async (req, res) => {
  try {
    const { group_name, group_description, max_size } = req.body;
    const result = await pool.query(
      `INSERT INTO groups (group_name, group_description, max_size, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [group_name, group_description, max_size, req.user.student_number]
    );
    res.status(201).json({ message: 'Group created successfully', group: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.put('/api/groups/:id', authenticateStudent, async (req, res) => {
  try {
    const { id } = req.params;
    const { group_name, group_description, max_size } = req.body;
    
    // Check if user is the creator
    const groupCheck = await pool.query('SELECT created_by FROM groups WHERE id = $1', [id]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (groupCheck.rows[0].created_by !== req.user.student_number) {
      return res.status(403).json({ error: 'Only group creator can update the group' });
    }

    const result = await pool.query(
      'UPDATE groups SET group_name = $1, group_description = $2, max_size = $3 WHERE id = $4 RETURNING *',
      [group_name, group_description, max_size, id]
    );

    res.json({ message: 'Group updated successfully', group: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.delete('/api/groups/:id', authenticateStudent, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is the creator
    const groupCheck = await pool.query('SELECT created_by FROM groups WHERE id = $1', [id]);
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (groupCheck.rows[0].created_by !== req.user.student_number) {
      return res.status(403).json({ error: 'Only group creator can delete the group' });
    }

    const result = await pool.query('DELETE FROM groups WHERE id = $1 RETURNING id', [id]);
    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== LINKS ROUTES ====================
app.get('/api/links', authenticateStudent, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, 
             c.name as connector_name, c.surname as connector_surname,
             a.name as acceptor_name, a.surname as acceptor_surname
      FROM links l
      LEFT JOIN students c ON l.connector = c.student_number
      LEFT JOIN students a ON l.acceptor = a.student_number
      WHERE l.connector = $1 OR l.acceptor = $1
      ORDER BY l.created_at DESC`,
      [req.user.student_number]
    );
    res.json({ links: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/links', authenticateStudent, async (req, res) => {
  try {
    const { acceptor } = req.body;
    const connector = req.user.student_number;

    if (connector === acceptor) {
      return res.status(400).json({ error: 'Cannot link with yourself' });
    }

    // Check if link already exists
    const existingLink = await pool.query(
      'SELECT id FROM links WHERE (connector = $1 AND acceptor = $2) OR (connector = $2 AND acceptor = $1)',
      [connector, acceptor]
    );

    if (existingLink.rows.length > 0) {
      return res.status(400).json({ error: 'Link already exists' });
    }

    const result = await pool.query(
      'INSERT INTO links (connector, acceptor) VALUES ($1, $2) RETURNING *',
      [connector, acceptor]
    );

    res.status(201).json({ message: 'Link created successfully', link: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.delete('/api/links/:id', authenticateStudent, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM links WHERE id = $1 AND (connector = $2 OR acceptor = $2) RETURNING id',
      [id, req.user.student_number]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found or access denied' });
    }
    res.json({ message: 'Link deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== EVENTS ROUTES ====================
app.get('/api/events', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, s.name as creator_name, s.surname as creator_surname
      FROM events e
      LEFT JOIN students s ON e.created_by = s.student_number
      ORDER BY e.event_datetime DESC`
    );
    res.json({ events: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/events', authenticateStudent, async (req, res) => {
  try {
    const { name, description, location, event_datetime } = req.body;
    const result = await pool.query(
     
      `INSERT INTO events (name, description, location, event_datetime, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, location, event_datetime, req.user.student_number]
    );
    res.status(201).json({ message: 'Event created successfully', event: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.put('/api/events/:id', authenticateStudent, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, location, event_datetime } = req.body;
    
    // Check if user is the creator
    const eventCheck = await pool.query('SELECT created_by FROM events WHERE id = $1', [id]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (eventCheck.rows[0].created_by !== req.user.student_number) {
      return res.status(403).json({ error: 'Only event creator can update the event' });
    }

    const result = await pool.query(
      'UPDATE events SET name = $1, description = $2, location = $3, event_datetime = $4 WHERE id = $5 RETURNING *',
      [name, description, location, event_datetime, id]
    );

    res.json({ message: 'Event updated successfully', event: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.delete('/api/events/:id', authenticateStudent, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is the creator
    const eventCheck = await pool.query('SELECT created_by FROM events WHERE id = $1', [id]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (eventCheck.rows[0].created_by !== req.user.student_number) {
      return res.status(403).json({ error: 'Only event creator can delete the event' });
    }

    const result = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id', [id]);
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== CLASSES ROUTES ====================
app.get('/api/classes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, m.module_name
      FROM classes c
      LEFT JOIN modules m ON c.module_id = m.id
      ORDER BY c.class_date, c.class_time`
    );
    res.json({ classes: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/classes', authenticateAdmin, async (req, res) => {
  try {
    const { class_name, module_id, class_time, class_date, duration_minutes, location, instructor } = req.body;
    const result = await pool.query(
      `INSERT INTO classes (class_name, module_id, class_time, class_date, duration_minutes, location, instructor)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [class_name, module_id, class_time, class_date, duration_minutes, location, instructor]
    );
    res.status(201).json({ message: 'Class created successfully', class: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/classes/:class_id/enroll', authenticateStudent, async (req, res) => {
  try {
    const { class_id } = req.params;
    const student_number = req.user.student_number;

    // Check if already enrolled
    const existingEnrollment = await pool.query(
      'SELECT * FROM student_classes WHERE student_number = $1 AND class_id = $2',
      [student_number, class_id]
    );

    if (existingEnrollment.rows.length > 0) {
      return res.status(400).json({ error: 'Already enrolled in this class' });
    }

    await pool.query(
      'INSERT INTO student_classes (student_number, class_id) VALUES ($1, $2)',
      [student_number, class_id]
    );

    res.json({ message: 'Successfully enrolled in class' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.delete('/api/classes/:class_id/enroll', authenticateStudent, async (req, res) => {
  try {
    const { class_id } = req.params;
    const student_number = req.user.student_number;

    const result = await pool.query(
      'DELETE FROM student_classes WHERE student_number = $1 AND class_id = $2 RETURNING *',
      [student_number, class_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    res.json({ message: 'Successfully unenrolled from class' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== POSTS ROUTES ====================
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, s.name as creator_name, s.surname as creator_surname,
             COUNT(l.id) as like_count
      FROM posts p
      LEFT JOIN students s ON p.created_by = s.student_number
      LEFT JOIN likes l ON p.id = l.post_id
      GROUP BY p.id, s.name, s.surname
      ORDER BY p.created_at DESC`
    );
    res.json({ posts: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/posts', authenticateStudent, async (req, res) => {
  try {
    const { title, caption } = req.body;
    const result = await pool.query(
      `INSERT INTO posts (title, caption, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [title, caption, req.user.student_number]
    );
    res.status(201).json({ message: 'Post created successfully', post: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/posts/:post_id/like', authenticateStudent, async (req, res) => {
  try {
    const { post_id } = req.params;
    const student_number = req.user.student_number;

    // Check if already liked
    const existingLike = await pool.query(
      'SELECT * FROM likes WHERE post_id = $1 AND student_number = $2',
      [post_id, student_number]
    );

    if (existingLike.rows.length > 0) {
      return res.status(400).json({ error: 'Post already liked' });
    }

    await pool.query(
      'INSERT INTO likes (post_id, student_number) VALUES ($1, $2)',
      [post_id, student_number]
    );

    res.json({ message: 'Post liked successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.delete('/api/posts/:post_id/like', authenticateStudent, async (req, res) => {
  try {
    const { post_id } = req.params;
    const student_number = req.user.student_number;

    const result = await pool.query(
      'DELETE FROM likes WHERE post_id = $1 AND student_number = $2 RETURNING *',
      [post_id, student_number]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Like not found' });
    }

    res.json({ message: 'Post unliked successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== BADGES ROUTES ====================
app.get('/api/badges/:student_number', async (req, res) => {
  try {
    const { student_number } = req.params;
    const result = await pool.query(
      'SELECT * FROM badges WHERE student_number = $1 ORDER BY awarded_at DESC',
      [student_number]
    );
    res.json({ badges: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/badges', authenticateAdmin, async (req, res) => {
  try {
    const { badge_name, description, student_number } = req.body;
    const result = await pool.query(
      `INSERT INTO badges (badge_name, description, student_number)
       VALUES ($1, $2, $3) RETURNING *`,
      [badge_name, description, student_number]
    );
    res.status(201).json({ message: 'Badge awarded successfully', badge: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== NOTIFICATIONS ROUTES ====================
app.get('/api/notifications', authenticateStudent, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE (target_type = 'student' AND target_student = $1)
       ORDER BY created_at DESC`,
      [req.user.student_number]
    );
    res.json({ notifications: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/notifications', authenticateAdmin, async (req, res) => {
  try {
    const { name, description, target_type, target_student, target_admin } = req.body;
    const result = await pool.query(
      `INSERT INTO notifications (name, description, target_type, target_student, target_admin)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, target_type, target_student, target_admin]
    );
    res.status(201).json({ message: 'Notification created successfully', notification: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== RATINGS ROUTES ====================
app.get('/api/ratings', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, 
             s.name as student_name, s.surname as student_surname,
             a.name as admin_name, a.surname as admin_surname
      FROM ratings r
      LEFT JOIN students s ON r.rator_student = s.student_number
      LEFT JOIN admin a ON r.rator_admin = a.admin_id
      ORDER BY r.rating_date DESC`
    );
    res.json({ ratings: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.post('/api/ratings', authenticateStudent, async (req, res) => {
  try {
    const { rating_value, rating_description } = req.body;
    const result = await pool.query(
      `INSERT INTO ratings (rator_type, rator_student, rating_value, rating_description)
       VALUES ('student', $1, $2, $3) RETURNING *`,
      [req.user.student_number, rating_value, rating_description]
    );
    res.status(201).json({ message: 'Rating submitted successfully', rating: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== SEARCH ROUTES ====================
app.get('/api/search/students', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const result = await pool.query(`
      SELECT student_number, name, surname, email, year_of_study, course_name, faculty_name
      FROM students s
      LEFT JOIN courses c ON s.course_id = c.id
      LEFT JOIN faculty f ON s.faculty_id = f.id
      WHERE s.name ILIKE $1 OR s.surname ILIKE $1 OR s.email ILIKE $1 OR s.student_number::text ILIKE $1
      ORDER BY s.name, s.surname
      LIMIT 50`,
      [`%${query}%`]
    );

    res.json({ students: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== DASHBOARD STATS ====================
app.get('/api/dashboard/stats', authenticateAdmin, async (req, res) => {
  try {
    const [
      studentsCount,
      coursesCount,
      facultiesCount,
      campusesCount,
      groupsCount,
      eventsCount,
      linksCount,
      postsCount
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM students'),
      pool.query('SELECT COUNT(*) FROM courses'),
      pool.query('SELECT COUNT(*) FROM faculty'),
      pool.query('SELECT COUNT(*) FROM campuses'),
      pool.query('SELECT COUNT(*) FROM groups'),
      pool.query('SELECT COUNT(*) FROM events'),
      pool.query('SELECT COUNT(*) FROM links'),
      pool.query('SELECT COUNT(*) FROM posts')
    ]);

    res.json({
      stats: {
        students: parseInt(studentsCount.rows[0].count),
        courses: parseInt(coursesCount.rows[0].count),
        faculties: parseInt(facultiesCount.rows[0].count),
        campuses: parseInt(campusesCount.rows[0].count),
        groups: parseInt(groupsCount.rows[0].count),
        events: parseInt(eventsCount.rows[0].count),
        links: parseInt(linksCount.rows[0].count),
        posts: parseInt(postsCount.rows[0].count)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== STUDENT DASHBOARD ====================
app.get('/api/student/dashboard', authenticateStudent, async (req, res) => {
  try {
    const student_number = req.user.student_number;
    
    const [
      linksCount,
      groupsCount,
      eventsCount,
      classesCount,
      badgesCount,
      postsCount
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM links WHERE connector = $1 OR acceptor = $1', [student_number]),
      pool.query('SELECT COUNT(*) FROM groups WHERE created_by = $1', [student_number]),
      pool.query('SELECT COUNT(*) FROM events WHERE created_by = $1', [student_number]),
      pool.query('SELECT COUNT(*) FROM student_classes WHERE student_number = $1', [student_number]),
      pool.query('SELECT COUNT(*) FROM badges WHERE student_number = $1', [student_number]),
      pool.query('SELECT COUNT(*) FROM posts WHERE created_by = $1', [student_number])
    ]);

    // Get recent activity
    const recentPosts = await pool.query(`
      SELECT * FROM posts WHERE created_by = $1 ORDER BY created_at DESC LIMIT 5
    `, [student_number]);

    const upcomingEvents = await pool.query(`
      SELECT * FROM events 
      WHERE event_datetime >= NOW() 
      ORDER BY event_datetime ASC 
      LIMIT 5
    `);

    res.json({
      stats: {
        links: parseInt(linksCount.rows[0].count),
        groups: parseInt(groupsCount.rows[0].count),
        events: parseInt(eventsCount.rows[0].count),
        classes: parseInt(classesCount.rows[0].count),
        badges: parseInt(badgesCount.rows[0].count),
        posts: parseInt(postsCount.rows[0].count)
      },
      recentPosts: recentPosts.rows,
      upcomingEvents: upcomingEvents.rows
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', async (req, res) => {
  try {
    const dbConnected = await testConnection();
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'Connected' : 'Disconnected',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ==================== START SERVER ====================
const startServer = async () => {
  try {
    // Test database connection
    await testConnection();
    
    app.listen(PORT, () => {
      console.log(`🚀 JSJ LinkUp server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔒 Server ready for API requests`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;