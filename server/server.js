require('dotenv').config();

const express = require("express");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const os = require("os");

const app = express();
const PORT = 4100;

// 🔧 环境判断：只在生产环境安装系统字体
function initializeFonts() {
  const isProduction = process.env.NODE_ENV === "production";
  const isLinux = os.platform() === "linux";

  console.log(
    `🔤 字体系统初始化 - 环境: ${
      isProduction ? "生产" : "开发"
    }, 系统: ${os.platform()}`
  );

  // 只在Linux生产环境安装系统字体
  if (isProduction && isLinux) {
    console.log("🐧 生产环境：安装字体到系统");
    installLinuxFonts();
  } else {
    console.log("💻 开发环境：跳过系统字体安装，使用网络字体");
  }
}

// Linux生产环境字体安装
function installLinuxFonts() {
  const fontsSourceDir = path.join(__dirname, "public/fonts");
  const systemFontsDir = "/usr/share/fonts/truetype/custom";

  exec(`sudo mkdir -p ${systemFontsDir}`, (error) => {
    if (!error) {
      exec(
        `sudo cp ${fontsSourceDir}/*.ttf ${fontsSourceDir}/*.otf ${systemFontsDir}/ 2>/dev/null`,
        (copyError) => {
          if (!copyError) {
            console.log("✅ 字体文件已复制到系统目录");
            exec("sudo fc-cache -fv", (cacheError) => {
              if (!cacheError) {
                console.log("✅ 生产环境字体系统初始化完成");
              }
            });
          }
        }
      );
    }
  });
}

// 🔧 启动时检查环境并初始化
setTimeout(initializeFonts, 1000);

// ✅ 添加字体静态托管
app.use(
  "/fonts",
  express.static(path.join(__dirname, "public/fonts"), {
    setHeaders(res) {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET");
    },
  })
);

const exportRouter = require("./routes/export");
app.use("/api/export", exportRouter);

app.use("/exports", express.static(path.join(__dirname, "exports")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server is running at http://0.0.0.0:${PORT}`);
});
