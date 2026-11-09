import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import db from "./config/database.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        message: "Concert Ticket API is running!"
    });
});

app.get("/api/health", async (req, res) => {
    try {
        await db.query("SELECT NOW()");

        res.json({
            status: "success",
            database: "connected"
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: "Database connection failed"
        });
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});