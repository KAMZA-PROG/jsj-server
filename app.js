// app.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// PostgreSQL connectionw

// Test connection
pool.connect((err) => {
  if (err) {
    console.error("PostgreSQL connection error:", err);
  } else {
    console.log("Connected to PostgreSQL database!");
  }
});

// -------------------- ROUTES -------------------- //
// Root
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// -------------------- CRUD EXAMPLES -------------------- //
// For brevity, I’ll show full CRUD for "students" table.
// You can replicate this for campuses, faculty, courses, etc.

// Get all students
app.get("/students", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM students ORDER BY student_number");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single student by student_number
app.get("/students/:student_number", async (req, res) => {
  try {
    const { student_number } = req.params;
    const result = await pool.query("SELECT * FROM students WHERE student_number=$1", [student_number]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new student
app.post("/students", async (req, res) => {
  try {
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
      phone_number,
    } = req.body;

    const query = `
      INSERT INTO students(student_number,name,surname,email,password,course_id,year_of_study,faculty_id,campus_id,phone_number)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `;
    const values = [
      student_number,
      name,
      surname,
      email,
      password,
      course_id,
      year_of_study,
      faculty_id,
      campus_id,
      phone_number,
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update student
app.put("/students/:student_number", async (req, res) => {
  try {
    const { student_number } = req.params;
    const {
      name,
      surname,
      email,
      password,
      course_id,
      year_of_study,
      faculty_id,
      campus_id,
      phone_number,
    } = req.body;

    const query = `
      UPDATE students
      SET name=$1, surname=$2, email=$3, password=$4, course_id=$5, year_of_study=$6, faculty_id=$7, campus_id=$8, phone_number=$9
      WHERE student_number=$10 RETURNING *
    `;
    const values = [name, surname, email, password, course_id, year_of_study, faculty_id, campus_id, phone_number, student_number];

    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete student
app.delete("/students/:student_number", async (req, res) => {
  try {
    const { student_number } = req.params;
    await pool.query("DELETE FROM students WHERE student_number=$1", [student_number]);
    res.json({ message: "Student deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- REPLICATE CRUD FOR OTHER TABLES -------------------- //
// Example: campuses, faculty, courses, modules, admin, groups, events, classes, etc.
// Just replace table names and fields accordingly.

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
