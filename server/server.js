const express = require("express");
const multer = require("multer");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 4000;

const exportRouter = require("./routes/export");
app.use("/api/export", exportRouter);

app.use("/exports", express.static(path.join(__dirname, "exports")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
