const ColorManager = require("./routes/colorManager");
const fs = require("fs");
const path = require("path");

async function testColorManagerSetup() {
  console.log("🧪 开始测试色彩管理配置...\n");

  const colorManager = new ColorManager();

  // 1. 检查ICC配置文件
  console.log("📁 检查ICC配置文件:");
  const profiles = ["Japan Color 2001 Coated", "sRGB", "US Web Coated SWOP"];

  const availableProfiles = {};
  profiles.forEach((profileName) => {
    const profilePath = colorManager.checkICCProfile(profileName);
    availableProfiles[profileName] = !!profilePath;
    console.log(`  ${profileName}: ${profilePath ? "✅ 可用" : "❌ 缺失"}`);
    if (profilePath) {
      try {
        const stats = fs.statSync(profilePath);
        console.log(`    路径: ${profilePath}`);
        console.log(`    大小: ${(stats.size / 1024).toFixed(1)} KB`);
      } catch (error) {
        console.log(`    ❌ 无法读取文件: ${error.message}`);
        availableProfiles[profileName] = false;
      }
    }
  });

  // 2. 检查色彩处理工具
  console.log("\n🔧 检查色彩处理工具:");
  const tools = await colorManager.checkColorTools();

  console.log(`  jpgicc: ${tools.jpgicc ? "✅ 可用" : "❌ 缺失"}`);
  console.log(
    `  ImageMagick: ${tools.imagemagick?.available ? "✅ 可用" : "❌ 缺失"}`
  );
  if (tools.imagemagick?.available) {
    console.log(`    版本: v${tools.imagemagick.version}`);
    console.log(`    命令: ${tools.imagemagick.command}`);
  }
  console.log(`  Ghostscript: ${tools.ghostscript ? "✅ 可用" : "❌ 缺失"}`);

  // 3. 生成测试PDF进行转换测试
  console.log("\n📄 测试PDF转换:");

  const testResults = await testPDFConversion(colorManager);

  // 4. 生成配置报告
  console.log("\n📊 配置总结:");
  generateConfigReport(availableProfiles, tools, testResults);

  return {
    profiles: availableProfiles,
    tools,
    testResults,
    ready: isSystemReady(availableProfiles, tools),
  };
}

async function testPDFConversion(colorManager) {
  try {
    // 创建一个简单的测试PDF
    const testPdfPath = await createTestPDF();
    const outputPdfPath = path.join(__dirname, "exports/test-output-cmyk.pdf");

    // 确保exports目录存在
    const exportsDir = path.dirname(outputPdfPath);
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    console.log("  创建测试PDF: ✅");

    // 测试CMYK转换
    const result = await colorManager.convertPDFToCMYKProfessional(
      testPdfPath,
      outputPdfPath,
      {
        iccProfile: "Japan Color 2001 Coated",
        quality: 95,
      }
    );

    console.log(`  CMYK转换: ${result.success ? "✅ 成功" : "❌ 失败"}`);
    if (result.success) {
      console.log(`    方法: ${result.method}`);
      console.log(`    使用ICC: ${result.usedICC ? "是" : "否"}`);

      // 检查输出文件
      if (fs.existsSync(outputPdfPath)) {
        const stats = fs.statSync(outputPdfPath);
        console.log(`    输出文件: ${(stats.size / 1024).toFixed(1)} KB`);
      }
    } else {
      console.log(`    错误: ${result.error}`);
    }

    // 清理测试文件
    cleanupTestFiles([testPdfPath, outputPdfPath]);

    return result;
  } catch (error) {
    console.log(`  转换测试: ❌ 失败 - ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function createTestPDF() {
  // 创建一个简单的测试SVG
  const testSvg = `
    <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="50" height="50" fill="#ff0000" />
      <rect x="50" y="50" width="50" height="50" fill="#00ff00" />
      <text x="25" y="25" fill="#0000ff" font-size="12">TEST</text>
    </svg>
  `;

  const testSvgPath = path.join(__dirname, "exports/test-input.svg");
  const testPdfPath = path.join(__dirname, "exports/test-input.pdf");

  // 确保exports目录存在
  const exportsDir = path.dirname(testSvgPath);
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // 写入SVG文件
  fs.writeFileSync(testSvgPath, testSvg);

  // 使用inkscape转换为PDF
  const { exec } = require("child_process");
  await new Promise((resolve, reject) => {
    exec(
      `inkscape "${testSvgPath}" --export-type=pdf --export-filename="${testPdfPath}"`,
      (error, stdout, stderr) => {
        if (error) {
          console.log(`    Inkscape错误: ${stderr}`);
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });

  // 清理SVG文件
  if (fs.existsSync(testSvgPath)) {
    fs.unlinkSync(testSvgPath);
  }

  return testPdfPath;
}

function cleanupTestFiles(files) {
  files.forEach((file) => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        console.log(`  清理测试文件: ${path.basename(file)}`);
      } catch (error) {
        console.log(`  清理失败: ${path.basename(file)} - ${error.message}`);
      }
    }
  });
}

function generateConfigReport(profiles, tools, testResults) {
  const hasJapanProfile = profiles["Japan Color 2001 Coated"];
  const hasSRGB = profiles["sRGB"];
  const hasColorTool =
    tools.jpgicc || tools.imagemagick?.available || tools.ghostscript;
  const conversionWorks = testResults.success;

  console.log(
    `  核心ICC配置: ${hasJapanProfile ? "✅" : "❌"} Japan Color 2001`
  );
  console.log(
    `  RGB配置: ${hasSRGB ? "✅" : "⚠️"} sRGB ${hasSRGB ? "" : "(可选)"}`
  );
  console.log(`  色彩工具: ${hasColorTool ? "✅" : "❌"} 至少一个可用`);
  console.log(
    `  转换测试: ${conversionWorks ? "✅" : "❌"} ${
      conversionWorks ? "正常" : "失败"
    }`
  );

  const readyLevel = calculateReadyLevel(
    hasJapanProfile,
    hasColorTool,
    conversionWorks
  );
  console.log(`\n🎯 系统状态: ${readyLevel.emoji} ${readyLevel.status}`);

  if (readyLevel.recommendations.length > 0) {
    console.log("\n💡 建议:");
    readyLevel.recommendations.forEach((rec) => console.log(`  ${rec}`));
  }
}

function calculateReadyLevel(hasJapanProfile, hasColorTool, conversionWorks) {
  if (hasJapanProfile && hasColorTool && conversionWorks) {
    return {
      emoji: "🚀",
      status: "完全就绪 - 可以开始使用专业色彩管理",
      recommendations: [],
    };
  }

  if (hasJapanProfile && hasColorTool) {
    return {
      emoji: "⚠️",
      status: "基本就绪 - 配置正确但转换测试失败",
      recommendations: [
        "检查inkscape是否正确安装: inkscape --version",
        "验证ICC配置文件权限",
        "查看详细错误日志",
      ],
    };
  }

  const recommendations = [];
  if (!hasJapanProfile) {
    recommendations.push("确保JapanColor2001Coated.icc在icc-profiles/目录中");
  }
  if (!hasColorTool) {
    recommendations.push("安装jpgicc (推荐) 或 ImageMagick");
  }

  return {
    emoji: "❌",
    status: "需要配置 - 缺少必要组件",
    recommendations,
  };
}

function isSystemReady(profiles, tools) {
  return (
    profiles["Japan Color 2001 Coated"] &&
    (tools.jpgicc || tools.imagemagick?.available || tools.ghostscript)
  );
}

// 运行测试
if (require.main === module) {
  testColorManagerSetup()
    .then((result) => {
      console.log("\n✨ 测试完成!");
      console.log(`系统就绪状态: ${result.ready ? "✅ 就绪" : "❌ 需要配置"}`);

      if (result.ready) {
        console.log("\n🎉 太好了！你现在可以:");
        console.log("  1. 在你的export.js中集成ColorManager");
        console.log("  2. 替换原有的convertToCMYKWithImageMagick函数");
        console.log("  3. 享受专业级的色彩管理 🎨");
      }
    })
    .catch((error) => {
      console.error("\n❌ 测试失败:", error.message);
      console.error("详细错误:", error.stack);
      process.exit(1);
    });
}

module.exports = { testColorManagerSetup };
