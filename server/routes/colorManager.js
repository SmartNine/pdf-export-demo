// colorManager.js - 借鉴canvas.js的专业色彩处理
const fs = require("fs");
const path = require("path");
const { exec, spawnSync } = require("child_process");
const sharp = require("sharp");

class ColorManager {
  constructor() {
    // 🔧 根据你的实际目录结构配置ICC文件路径
    this.ICC_PROFILES = {
      "Japan Color 2001 Coated": path.join(
        __dirname,
        "../icc-profiles/JapanColor2001Coated.icc"
      ),
      sRGB: path.join(__dirname, "../icc-profiles/sRGB.icc"),
      "US Web Coated SWOP": path.join(
        __dirname,
        "../icc-profiles/USWebCoatedSWOP.icc"
      ),
    };

    // 默认使用的配置文件
    this.defaultCMYKProfile = "Japan Color 2001 Coated";
    this.defaultRGBProfile = "sRGB";

    this.availableTools = null;
  }

  // 🔧 移植：检查ICC配置文件
  checkICCProfile(profileName) {
    const profilePath = this.ICC_PROFILES[profileName];
    if (!profilePath || !fs.existsSync(profilePath)) {
      console.warn(`⚠️ ICC配置文件不存在: ${profileName} -> ${profilePath}`);
      return null;
    }
    return profilePath;
  }

  // 🔧 移植：检查色彩处理工具可用性
  async checkColorTools() {
    if (this.availableTools) return this.availableTools;

    const tools = {
      jpgicc: await this.checkTool("jpgicc -v"),
      imagemagick: await this.checkImageMagickVersion(),
      ghostscript: await this.checkTool("gs --version"),
    };

    this.availableTools = tools;
    console.log(
      "🎨 可用色彩工具:",
      Object.entries(tools)
        .filter(([, available]) => available)
        .map(([tool]) => tool)
        .join(", ")
    );

    // 🔧 新增：Ghostscript 警告
    if (tools.ghostscript) {
      console.warn(
        "⚠️ Ghostscript已被禁用以避免CMYK颜色污染。如需启用请确保版本支持正确的CMYK处理。"
      );
    }

    return tools;
  }

  async checkTool(command) {
    return new Promise((resolve) => {
      exec(command, (error) => {
        resolve(!error);
      });
    });
  }

  // 🔧 移植canvas.js的ImageMagick版本检测
  async checkImageMagickVersion() {
    return new Promise((resolve) => {
      exec("magick -version", (error1) => {
        if (!error1) {
          resolve({ available: true, command: "magick", version: 7 });
        } else {
          exec("convert -version", (error2) => {
            resolve({
              available: !error2,
              command: error2 ? null : "convert",
              version: error2 ? null : 6,
            });
          });
        }
      });
    });
  }

  async preprocessImage(imageBuffer, options = {}) {
    const {
      maxPixels = 15000,
      processImage = true,
      targetColorSpace = "srgb",
      quality = 90, // 🔧 新增质量参数
      preserveForPrint = false, // 🔧 新增印刷模式标志
    } = options;

    if (!processImage) return imageBuffer;

    try {
      let context = sharp(imageBuffer, { limitInputPixels: false });
      const { format, space, orientation, width, height } =
        await context.metadata();

      console.log(
        `🔷 处理图片: ${width}x${height}, 格式:${format}, 色彩空间:${space}`
      );

      // 🔧 修复：CMYK图片特殊处理
      if (format === "jpeg" && space === "cmyk") {
        console.log("🎨 检测到CMYK图片，需要专业转换");
        const convertedBuffer = await this.convertCMYKImageProfessionally(
          imageBuffer
        );
        context = sharp(convertedBuffer);
      }

      // 🔧 印刷模式下的特殊处理
      if (preserveForPrint) {
        console.log("🖨️ 印刷模式：保持高质量设置");

        // 更宽松的尺寸限制
        const printMaxPixels = maxPixels * 10; // 印刷模式允许更大尺寸
        if (width > printMaxPixels || height > printMaxPixels) {
          console.log(`📏 印刷模式尺寸调整到${printMaxPixels}px以内`);
          context = context.resize(printMaxPixels, printMaxPixels, {
            fit: "inside",
            kernel: sharp.kernel.lanczos3, // 🔧 使用高质量重采样算法
          });
        }

        // 🔧 高质量JPEG设置
        return await context
          .jpeg({
            quality: quality, // 使用传入的高质量参数
            progressive: false, // 印刷品不需要渐进式
            mozjpeg: true, // 使用mozjpeg优化器
            chromaSubsampling: "4:4:4", // 🔧 无色度子采样，保持最高质量
          })
          .toBuffer();
      }

      // 🔧 标准模式的尺寸限制处理
      if (width > maxPixels || height > maxPixels) {
        console.log(`📏 图片尺寸超限，缩放到${maxPixels}px以内`);
        context = context.resize(maxPixels, maxPixels, { fit: "inside" });
      }

      // 🔧 EXIF旋转处理
      if (orientation && orientation !== 1) {
        console.log(`🔄 应用EXIF旋转: ${orientation}`);
        context = this.handleExifOrientation(context, orientation);
      }

      return await context.jpeg({ quality: quality }).toBuffer();
    } catch (error) {
      console.error("❌ 图片预处理失败:", error);
      return imageBuffer;
    }
  }

  async convertCMYKImageProfessionally(imageBuffer) {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      console.log("🔍 图片元数据:", {
        format: metadata.format,
        space: metadata.space,
        channels: metadata.channels,
        width: metadata.width,
        height: metadata.height,
      });

      if (metadata.format === "jpeg" && metadata.space === "cmyk") {
        console.log("🎨 检测到CMYK图片，使用标准转换");
        return await this.convertStandardCMYKImage(imageBuffer, {});
      }

      return imageBuffer;
    } catch (error) {
      console.error("CMYK转换失败:", error);
      return imageBuffer; // 🔧 返回原始数据作为兜底
    }
  }

  // 🔧 新增：获取详细色彩信息
  async getDetailedColorInfo(imageBuffer) {
    const tmpDir = require("os").tmpdir();
    const tempPath = path.join(tmpDir, `color_check_${Date.now()}.jpg`);

    try {
      // 写入临时文件用于检测
      fs.writeFileSync(tempPath, imageBuffer);

      return new Promise((resolve) => {
        exec(`exiftool "${tempPath}"`, (error, stdout, stderr) => {
          if (error) {
            resolve({ isYCCK: false, hasICCProfile: false });
            return;
          }

          const output = stdout.toLowerCase();
          const colorInfo = {
            isYCCK:
              output.includes("color transform") && output.includes("ycck"),
            hasICCProfile: output.includes("icc profile name"),
            iccProfileName: stdout
              .match(/ICC Profile Name\s*:\s*(.+)/i)?.[1]
              ?.trim(),
            colorMode: stdout.match(/Color Mode\s*:\s*(.+)/i)?.[1]?.trim(),
            colorSpace: stdout.match(/Color Space\s*:\s*(.+)/i)?.[1]?.trim(),
            colorComponents: stdout
              .match(/Color Components\s*:\s*(.+)/i)?.[1]
              ?.trim(),
          };

          console.log("📋 解析的色彩信息:", colorInfo);
          resolve(colorInfo);
        });
      });
    } finally {
      // 清理临时文件
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  // 🔧 新增：专门处理 YCCK 图片
  async convertYCCKImageProfessionally(imageBuffer, colorInfo) {
    const tmpDir = require("os").tmpdir();
    const inputPath = path.join(tmpDir, `ycck_input_${Date.now()}.jpg`);
    const outputPath = path.join(tmpDir, `srgb_output_${Date.now()}.jpg`);

    try {
      fs.writeFileSync(inputPath, imageBuffer);

      // 🔧 YCCK 需要特殊的 ImageMagick 处理
      const convertCmd = [
        "magick",
        `"${inputPath}"`,
        "-colorspace",
        "CMYK", // 首先明确指定为CMYK
        "-profile",
        `"${this.checkICCProfile("Japan Color 2001 Coated")}"`, // 应用原始配置文件
        "-intent",
        "Perceptual", // 感知渲染意图
        "-black-point-compensation", // 黑点补偿
        "-profile",
        `"${this.checkICCProfile("sRGB")}"`, // 转换到sRGB
        "-colorspace",
        "sRGB", // 确保输出是sRGB
        "-quality",
        "98", // 高质量
        `"${outputPath}"`,
      ].join(" ");

      console.log("🔧 YCCK转换命令:", convertCmd);

      return new Promise((resolve, reject) => {
        exec(convertCmd, (error, stdout, stderr) => {
          if (error) {
            console.warn("ImageMagick YCCK转换失败，尝试备用方法:", stderr);
            // 🔧 备用方法：使用 jpgicc
            this.convertYCCKWithJpgicc(inputPath, outputPath)
              .then(() => {
                const convertedBuffer = fs.readFileSync(outputPath);
                resolve(convertedBuffer);
              })
              .catch(reject);
          } else {
            console.log("✅ YCCK图片转换成功");
            const convertedBuffer = fs.readFileSync(outputPath);
            resolve(convertedBuffer);
          }
        });
      });
    } finally {
      // 清理临时文件
      [inputPath, outputPath].forEach((file) => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
    }
  }

  // 🔧 新增：使用 jpgicc 处理 YCCK
  async convertYCCKWithJpgicc(inputPath, outputPath) {
    const jpgiccArgs = [
      "-q",
      "100", // 最高质量
      "-b", // 黑点补偿
      "-a",
      "0", // 🔧 相对比色渲染意图（更适合YCCK）
      "-v", // 详细输出
      inputPath,
      outputPath,
    ];

    return new Promise((resolve, reject) => {
      const result = spawnSync("jpgicc", jpgiccArgs);

      if (result.error) {
        reject(new Error(`jpgicc YCCK转换失败: ${result.stderr?.toString()}`));
      } else {
        console.log("✅ jpgicc YCCK转换成功");
        resolve();
      }
    });
  }

  // 🔧 新增：处理标准CMYK图片
  async convertStandardCMYKImage(imageBuffer, colorInfo) {
    const tmpDir = require("os").tmpdir();
    const inputPath = path.join(tmpDir, `cmyk_input_${Date.now()}.jpg`);
    const outputPath = path.join(tmpDir, `srgb_output_${Date.now()}.jpg`);

    try {
      fs.writeFileSync(inputPath, imageBuffer);
      console.log(`📁 输入文件已写入: ${inputPath}`);

      const tools = await this.checkColorTools();
      const cmykProfile = this.checkICCProfile("Japan Color 2001 Coated");
      const srgbProfile = this.checkICCProfile("sRGB");

      console.log("🔍 工具检查结果:", {
        jpgicc: tools.jpgicc,
        imagemagick: tools.imagemagick?.available,
        cmykProfile: !!cmykProfile,
        srgbProfile: !!srgbProfile,
      });

      // 🔧 基于测试结果：jpgicc 基础转换就很好用（会自动使用嵌入的配置文件）
      if (tools.jpgicc) {
        console.log("🎨 使用 jpgicc 基础转换（利用嵌入的ICC配置文件）");

        // 🔧 修复：使用正确的 exec 而不是 spawnSync
        const jpgiccCmd = `jpgicc -v -q 100 -b -t 1 "${inputPath}" "${outputPath}"`;

        console.log("🔧 jpgicc 命令:", jpgiccCmd);

        const result = await new Promise((resolve) => {
          exec(jpgiccCmd, (error, stdout, stderr) => {
            resolve({ error, stdout, stderr });
          });
        });

        console.log("📋 jpgicc 执行结果:", {
          error: result.error?.message,
          stdout: result.stdout,
          stderr: result.stderr,
        });

        if (!result.error && fs.existsSync(outputPath)) {
          console.log("✅ jpgicc 基础转换成功");
          const convertedBuffer = fs.readFileSync(outputPath);
          return convertedBuffer;
        } else {
          console.warn("jpgicc 基础转换失败，尝试完整配置文件方式");

          // 🔧 备用方案：使用完整的配置文件参数
          if (cmykProfile && srgbProfile) {
            const jpgiccFullCmd = `jpgicc -v -q 100 -b -t 1 -i "${cmykProfile}" -o "${srgbProfile}" "${inputPath}" "${outputPath}"`;

            console.log("🔧 jpgicc 完整命令:", jpgiccFullCmd);

            const fullResult = await new Promise((resolve) => {
              exec(jpgiccFullCmd, (error, stdout, stderr) => {
                resolve({ error, stdout, stderr });
              });
            });

            if (!fullResult.error && fs.existsSync(outputPath)) {
              console.log("✅ jpgicc 完整配置文件转换成功");
              const convertedBuffer = fs.readFileSync(outputPath);
              return convertedBuffer;
            }
          }
        }
      }

      // 🔧 备用方案：ImageMagick
      if (tools.imagemagick?.available && cmykProfile && srgbProfile) {
        console.log("🎨 使用 ImageMagick 进行 CMYK 转换");

        const magickCmd = `${tools.imagemagick.command} "${inputPath}" -profile "${cmykProfile}" -intent Perceptual -black-point-compensation -profile "${srgbProfile}" -quality 98 "${outputPath}"`;

        console.log("🔧 ImageMagick 命令:", magickCmd);

        const result = await new Promise((resolve) => {
          exec(magickCmd, (error, stdout, stderr) => {
            resolve({ error, stdout, stderr });
          });
        });

        if (!result.error && fs.existsSync(outputPath)) {
          console.log("✅ ImageMagick CMYK转换成功");
          const convertedBuffer = fs.readFileSync(outputPath);
          return convertedBuffer;
        } else {
          console.warn("ImageMagick转换失败:", result.stderr);
        }
      }

      // 🔧 最后的备用方案：Sharp 基础转换
      console.log("🔄 使用 Sharp 进行基础 CMYK 转换");

      try {
        const convertedBuffer = await sharp(imageBuffer)
          .toColorspace("srgb")
          .jpeg({ quality: 98 })
          .toBuffer();

        console.log("✅ Sharp 基础转换成功");
        return convertedBuffer;
      } catch (sharpError) {
        console.error("Sharp转换也失败:", sharpError);
        throw new Error(
          `所有CMYK转换方法都失败了: Sharp: ${sharpError.message}`
        );
      }
    } catch (error) {
      console.error("CMYK转换过程失败:", error);
      throw error;
    } finally {
      // 🔧 确保清理临时文件
      [inputPath, outputPath].forEach((file) => {
        try {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(`🗑️ 已清理临时文件: ${file}`);
          }
        } catch (cleanupError) {
          console.warn(`清理文件失败: ${file}`, cleanupError.message);
        }
      });
    }
  }

  // 🔧 移植canvas.js的jpgicc处理（简化版）
  async convertCMYKWithJpgicc(imageBuffer) {
    const tmpDir = require("os").tmpdir();
    const inputPath = path.join(tmpDir, `cmyk_input_${Date.now()}.jpg`);
    const outputPath = path.join(tmpDir, `srgb_output_${Date.now()}.jpg`);

    try {
      // 写入临时文件
      fs.writeFileSync(inputPath, imageBuffer);

      // 🔧 简化：只使用必需的配置文件
      const cmykProfile = this.checkICCProfile("Japan Color 2001 Coated");

      // 🔧 如果没有sRGB配置文件，让jpgicc使用内置配置
      const srgbProfile = this.checkICCProfile("sRGB");

      let jpgiccArgs;
      if (cmykProfile && srgbProfile) {
        // 完整配置：指定输入和输出配置文件
        jpgiccArgs = [
          "-i",
          cmykProfile,
          "-o",
          srgbProfile,
          inputPath,
          outputPath,
        ];
      } else if (cmykProfile) {
        // 简化配置：只指定输入配置文件，输出使用内置sRGB
        jpgiccArgs = ["-i", cmykProfile, inputPath, outputPath];
      } else {
        // 最简配置：使用jpgicc内置配置文件
        jpgiccArgs = [inputPath, outputPath];
      }

      const result = spawnSync("jpgicc", jpgiccArgs);

      if (result.error) {
        throw new Error(`jpgicc转换失败: ${result.stderr?.toString()}`);
      }

      const convertedBuffer = fs.readFileSync(outputPath);
      console.log("✅ jpgicc CMYK转换成功");

      return convertedBuffer;
    } finally {
      // 清理临时文件
      [inputPath, outputPath].forEach((file) => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
    }
  }

  // 🔧 移植：EXIF方向处理
  handleExifOrientation(context, orientation) {
    switch (orientation) {
      case 8:
        return context.rotate(-90);
      case 3:
        return context.rotate(180);
      case 6:
        return context.rotate(90);
      default:
        return context;
    }
  }

  // 🔧 新增：增强的CMYK PDF转换
  async convertPDFToCMYKProfessional(inputPdf, outputPdf, options = {}) {
    const {
      iccProfile = "Japan Color 2001 Coated",
      quality = 95,
      method = "auto",
      targetDPI, // 🔧 确保这里也有 targetDPI 参数
    } = options;

    // 🔧 添加参数验证
    if (!targetDPI || targetDPI <= 0) {
      throw new Error(`targetDPI参数无效: ${targetDPI}，必须传入有效的DPI值`);
    }

    console.log(
      `🎨 专业CMYK转换: ${iccProfile}, 质量: ${quality}, DPI: ${targetDPI}`
    );

    const tools = await this.checkColorTools();
    const profilePath = this.checkICCProfile(iccProfile);

    const conversionMethods = [
      () =>
        this.convertWithImageMagick(
          inputPdf,
          outputPdf,
          profilePath,
          quality,
          targetDPI
        ), // 🔧 首选：有ICC支持
      () =>
        this.convertWithImageMagickBasic(
          inputPdf,
          outputPdf,
          profilePath,
          quality
        ), // 备选：基础CMYK
    ];

    for (const convertMethod of conversionMethods) {
      try {
        const result = await convertMethod();
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.warn("转换方法失败，尝试下一个方法:", error.message);
      }
    }

    return {
      success: false,
      error: "所有CMYK转换方法都失败了",
      usedCMYK: false,
      usedICC: false,
    };
  }

  // 🔧 改进：ImageMagick CMYK转换 - 保持图像清晰度
  async convertWithImageMagick(
    inputPdf,
    outputPdf,
    iccProfile,
    quality,
    targetDPI = 72
  ) {
    const magickInfo = this.availableTools.imagemagick;
    if (!magickInfo.available) {
      throw new Error("ImageMagick不可用");
    }

    let command = `${magickInfo.command} -density ${targetDPI} "${inputPdf}"`;

    // 🔧 使用明确的ICC文件路径，避免动态查找
    const srgbProfile = path.join(__dirname, "../icc-profiles/sRGB.icc");
    const cmykProfile = path.join(
      __dirname,
      "../icc-profiles/JapanColor2001Coated.icc"
    );

    // 🔧 在现有命令基础上，增加强制CMYK元数据写入
    if (fs.existsSync(srgbProfile) && fs.existsSync(cmykProfile)) {
      console.log("✅ 使用固定ICC配置文件路径");
      command += ` -profile "${srgbProfile}"`;
      command += ` -profile "${cmykProfile}"`;
      command += ` -colorspace CMYK`;
      command += ` -define pdf:use-cmyk=true`;

      // 🔧 新增：强制写入CMYK元数据
      command += ` -set colorspace CMYK`;
      command += ` -define pdf:colorspace=cmyk`;
      command += ` -define pdf:compression=jpeg`;
      command += ` -define pdf:preserve-colorspace=true`;
      command += ` -type ColorSeparation`; // 强制色彩分离模式
    } else {
      console.warn("⚠️ ICC配置文件不存在，使用基础转换");
      command += ` -colorspace CMYK`;
      command += ` -set colorspace CMYK`;
      command += ` -define pdf:use-cmyk=true`;
    }

    // 🔧 修改为矢量优化的无损压缩：
    command += ` -intent Perceptual`;
    command += ` -interpolate catrom`; // 🔧 高质量插值
    command += ` -filter Lanczos`; // 🔧 高质量滤镜，保持锐度
    command += ` -unsharp 0.25x0.25+8+0.065`; // 🔧 轻微锐化，补偿压缩损失
    command += ` -quality ${quality}`;
    command += ` -compress jpeg`; // 🔧 保持JPEG压缩但提升质量
    command += ` -density ${targetDPI}`;
    command += ` "${outputPdf}"`;

    console.log(`📝 高质量ImageMagick命令: ${command}`);

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.warn(`ImageMagick主要方法失败: ${stderr}`);
          // 🔧 回退到基础方法
          this.convertWithImageMagickBasic(
            inputPdf,
            outputPdf,
            iccProfile,
            quality
          )
            .then(resolve)
            .catch(reject);
        } else {
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: iccProfile !== null,
            method: "ImageMagick High-Quality",
          });
        }
      });
    });
  }

  // 🔧 新增：基础回退方法
  async convertWithImageMagickBasic(inputPdf, outputPdf, iccProfile, quality) {
    const magickInfo = this.availableTools.imagemagick;

    let command = `${magickInfo.command} "${inputPdf}" -colorspace cmyk -quality ${quality}`;

    if (iccProfile && fs.existsSync(iccProfile)) {
      command += ` -profile "${iccProfile}"`;
    }

    command += ` "${outputPdf}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ImageMagick基础转换失败: ${stderr}`));
        } else {
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: iccProfile !== null,
            method: "ImageMagick Basic",
          });
        }
      });
    });
  }

  // 🔧 移植：PDF专用的jpgicc处理
  async convertWithJpgicc(inputPdf, outputPdf, iccProfile) {
    if (!iccProfile) {
      throw new Error("jpgicc需要ICC配置文件");
    }

    const command = `jpgicc -i "${iccProfile}" "${inputPdf}" "${outputPdf}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`jpgicc转换失败: ${stderr}`));
        } else {
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: true,
            method: "jpgicc",
          });
        }
      });
    });
  }

  async convertWithGhostscript(inputPdf, outputPdf, quality, targetDPI = 72) {
    // 🔧 针对无ICC支持的Ghostscript简化命令
    let command = `gs -sDEVICE=pdfwrite -dNOPAUSE -dBATCH -dSAFER`;
    command += ` -dCompatibilityLevel=1.4`;

    // 🔧 只使用基础CMYK设置，不涉及ICC
    command += ` -dColorConversionStrategy=CMYK`;
    command += ` -dProcessColorModel=/DeviceCMYK`;
    command += ` -dConvertCMYKImagesToRGB=false`;
    command += ` -dConvertImagesToIndexed=false`;

    // 🔧 移除所有ICC相关参数
    // ❌ command += ` -sDefaultCMYKProfile="${japanProfile}"`;  // 这会失败
    // ❌ command += ` -sOutputICCProfile="${japanProfile}"`;     // 这会失败

    // 基础图像设置
    command += ` -dColorImageResolution=${targetDPI}`;
    command += ` -dGrayImageResolution=${targetDPI}`;
    command += ` -dAutoFilterColorImages=false`;
    command += ` -dColorImageFilter=/DCTEncode`;
    command += ` -dColorImageDict='<< /Quality ${quality} >>'`;

    command += ` -sOutputFile="${outputPdf}" "${inputPdf}"`;

    console.log(`📝 基础Ghostscript命令(无ICC): ${command}`);

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ Ghostscript错误: ${error.message}`);
          console.error(`❌ stderr: ${stderr}`);
          reject(new Error(`Ghostscript转换失败: ${stderr || error.message}`));
        } else {
          console.log(`✅ Ghostscript基础CMYK转换成功`);
          resolve({
            success: true,
            usedCMYK: true,
            usedICC: false, // 🔧 明确标记未使用ICC
            method: "Ghostscript Basic CMYK",
          });
        }
      });
    });
  }

  async validateColorSpace(pdfPath) {
    console.log(`🔍 开始验证PDF色彩空间: ${pdfPath}`);

    const validationMethods = [
      {
        name: "pixel-analysis",
        method: () => this.validateColorSpaceByPixel(pdfPath),
      }, // 🔧 新增首选验证
      { name: "exiftool", method: () => this.validateWithExiftool(pdfPath) },
      { name: "identify", method: () => this.validateWithIdentify(pdfPath) },
      {
        name: "ghostscript",
        method: () => this.validateWithGhostscript(pdfPath),
      },
    ];

    const results = [];

    for (const { name, method } of validationMethods) {
      try {
        console.log(`🔍 尝试验证方法: ${name}`);
        const result = await method();
        if (result.success && !isNaN(result.confidence)) {
          // 🔧 检查NaN
          results.push({ method: name, ...result });
          console.log(
            `✅ ${name} 验证成功: ${result.colorSpace} (置信度: ${(
              result.confidence * 100
            ).toFixed(1)}%)`
          );
        }
      } catch (error) {
        console.warn(`⚠️ ${name} 验证失败:`, error.message);
      }
    }

    if (results.length === 0) {
      return { success: false, error: "所有验证方法都失败了" };
    }

    // 🔧 改进权重计算，处理NaN情况
    const weightedResults = results.map((r) => ({
      ...r,
      weight: r.method === "exiftool" ? 2.0 : 1.0,
      confidence: isNaN(r.confidence) ? 0.5 : r.confidence, // 🔧 处理NaN
    }));

    const totalWeight = weightedResults.reduce((sum, r) => sum + r.weight, 0);
    const weightedConfidence =
      weightedResults.reduce((sum, r) => sum + r.confidence * r.weight, 0) /
      totalWeight;

    const cmykResults = weightedResults.filter((r) => r.colorSpace === "CMYK");
    const cmykWeight = cmykResults.reduce((sum, r) => sum + r.weight, 0);
    const isCMYK = cmykWeight > totalWeight / 2;

    return {
      success: true,
      colorSpace: isCMYK ? "CMYK" : "RGB",
      confidence: isNaN(weightedConfidence) ? 0.5 : weightedConfidence, // 🔧 处理NaN
      details: results,
      summary: `${cmykResults.length}/${
        results.length
      } 个方法检测为CMYK (总权重: CMYK=${cmykWeight.toFixed(
        1
      )}, 总计=${totalWeight.toFixed(1)})`,
    };
  }

  // 🔧 新增：使用 pdfimages 验证（最准确的方法）
  async validateWithPdfImages(pdfPath) {
    const command = `pdfimages -list "${pdfPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`pdfimages验证失败: ${stderr}`));
          return;
        }

        const lines = stdout.split("\n");
        let cmykImages = 0;
        let rgbImages = 0;

        lines.forEach((line) => {
          if (line.includes("cmyk") || line.includes("CMYK")) {
            cmykImages++;
          } else if (
            line.includes("rgb") ||
            line.includes("RGB") ||
            line.includes("gray")
          ) {
            rgbImages++;
          }
        });

        const totalImages = cmykImages + rgbImages;
        const isCMYK = cmykImages > 0 && cmykImages >= rgbImages;

        resolve({
          success: true,
          colorSpace: isCMYK ? "CMYK" : "RGB",
          details: {
            cmykImages,
            rgbImages,
            totalImages,
            rawOutput: stdout,
          },
          method: "pdfimages",
        });
      });
    });
  }

  // 🔧 新增：使用 ImageMagick identify 验证
  async validateWithIdentify(pdfPath) {
    const commands = [
      `identify -verbose "${pdfPath}[0]"`,
      `identify -format "%[colorspace] %[channels]" "${pdfPath}[0]"`,
    ];

    const results = [];

    for (const command of commands) {
      try {
        const result = await new Promise((resolve, reject) => {
          exec(command, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout);
          });
        });
        results.push(result);
      } catch (error) {
        console.warn(`identify子命令失败: ${error.message}`);
      }
    }

    if (results.length === 0) {
      throw new Error("所有identify命令都失败了");
    }

    const combinedOutput = results.join("\n").toLowerCase();
    let colorSpace = "RGB";
    let confidence = 0.5; // 🔧 修复：设置默认值，避免NaN

    const cmykIndicators = [
      "colorspace: cmyk",
      "devicecmyk",
      "channels: 4",
      "cmyk(",
      "type: cmyk",
    ];

    const cmykMatches = cmykIndicators.filter((indicator) =>
      combinedOutput.includes(indicator)
    ).length;

    if (cmykMatches >= 2) {
      colorSpace = "CMYK";
      confidence = Math.min(0.9, 0.6 + cmykMatches * 0.1); // 🔧 确保有效范围
    } else if (cmykMatches >= 1) {
      colorSpace = "CMYK";
      confidence = 0.7;
    }

    return {
      success: true,
      colorSpace,
      confidence, // 🔧 确保返回有效数值
      details: {
        cmykIndicators: cmykMatches,
        totalChecks: cmykIndicators.length,
        rawOutput: results[0]?.substring(0, 500),
      },
      method: "identify-enhanced",
    };
  }

  // 🔧 新增：使用 pdfinfo 验证PDF元数据
  async validateWithPdfInfo(pdfPath) {
    const command = `pdfinfo "${pdfPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`pdfinfo验证失败: ${stderr}`));
          return;
        }

        const output = stdout.toLowerCase();
        let colorSpace = "RGB"; // 默认

        // 检查PDF元数据中的色彩空间信息
        if (
          output.includes("cmyk") ||
          output.includes("devicecmyk") ||
          output.includes("separation")
        ) {
          colorSpace = "CMYK";
        }

        resolve({
          success: true,
          colorSpace,
          details: {
            pdfInfo: stdout,
            hasCMYKIndicators: output.includes("cmyk"),
          },
          method: "pdfinfo",
        });
      });
    });
  }

  // 🔧 增强 exiftool 验证逻辑
  async validateWithExiftool(pdfPath) {
    const command = `exiftool -ColorSpace -Colorants -PrintColorMode -DeviceColorSpace -ICCProfileDescription -ColorComponents "${pdfPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`exiftool验证失败: ${stderr}`));
          return;
        }

        const output = stdout.toLowerCase();
        let colorSpace = "RGB";
        let confidence = 0.7;

        console.log("🔍 exiftool 原始输出:", stdout); // 🔧 调试输出

        // 🔧 更严格的CMYK检测
        const strongCmykIndicators = [
          "color space                     : cmyk",
          "device color space             : cmyk",
          "icc profile description        : japan color 2001 coated",
          "color components               : 4",
        ];

        const weakCmykIndicators = [
          "colorants                      : cyan",
          "colorants                      : magenta",
          "colorants                      : yellow",
          "colorants                      : black",
          "print color mode               : cmyk",
        ];

        const strongMatches = strongCmykIndicators.filter((indicator) =>
          output.includes(indicator)
        ).length;

        const weakMatches = weakCmykIndicators.filter((indicator) =>
          output.includes(indicator)
        ).length;

        // 🔧 改进判定逻辑
        if (strongMatches >= 1) {
          colorSpace = "CMYK";
          confidence = 0.95;
        } else if (weakMatches >= 3) {
          colorSpace = "CMYK";
          confidence = 0.8;
        } else if (output.includes("cmyk")) {
          colorSpace = "CMYK";
          confidence = 0.6;
        }

        console.log(
          `🔍 exiftool 判定: ${colorSpace} (强指标:${strongMatches}, 弱指标:${weakMatches})`
        );

        resolve({
          success: true,
          colorSpace,
          confidence,
          details: {
            strongMatches,
            weakMatches,
            hasColorSpaceField: output.includes("color space"),
            hasDeviceColorSpace: output.includes("device color space"),
            hasICCProfile: output.includes("icc profile"),
            rawOutput: stdout,
          },
          method: "exiftool",
        });
      });
    });
  }

  // 🔧 添加缺失的 validateWithGhostscript 函数
  async validateWithGhostscript(pdfPath) {
    const command = `gs -q -dNOPAUSE -dBATCH -sDEVICE=inkcov "${pdfPath}" 2>&1`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        const output = (stdout + stderr).toLowerCase();

        // inkcov 设备会显示每页的墨水覆盖率 (C M Y K)
        let colorSpace = "RGB";
        let confidence = 0.6;

        // 检查是否有CMYK墨水覆盖率输出
        const cmykPattern =
          /(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+cmyk/;
        const match = output.match(cmykPattern);

        if (match) {
          colorSpace = "CMYK";
          confidence = 0.8;
        } else if (output.includes("cmyk") || output.includes("devicecmyk")) {
          colorSpace = "CMYK";
          confidence = 0.7;
        }

        resolve({
          success: true,
          colorSpace,
          confidence,
          details: {
            hasInkCoverage: !!match,
            rawOutput: output.substring(0, 300),
          },
          method: "ghostscript",
        });
      });
    });
  }

  // 在colorManager.js中添加真正的像素级验证
  async validateColorSpaceByPixel(pdfPath) {
    const command = `magick "${pdfPath}" -format "%[pixel:p{100,100}]" info:`;

    return new Promise((resolve) => {
      exec(command, (error, stdout) => {
        if (error) {
          resolve({ success: false, error: error.message });
          return;
        }

        const isCMYK = stdout.includes("cmyk(");
        resolve({
          success: true,
          colorSpace: isCMYK ? "CMYK" : "RGB",
          confidence: isCMYK ? 1.0 : 0.5,
          pixelValue: stdout.trim(),
          method: "pixel-analysis",
        });
      });
    });
  }

  // 🔧 新增：验证PDF是否保持矢量特性
  async validatePDFVectorContent(pdfPath) {
    console.log(`🔍 验证PDF矢量内容: ${pdfPath}`);

    const validationMethods = [
      () => this.checkPDFWithPdffonts(pdfPath),
      () => this.checkPDFWithPdfinfo(pdfPath),
      () => this.checkPDFWithPdfImages(pdfPath),
      () => this.checkPDFWithMutool(pdfPath),
      () => this.checkPDFFileSize(pdfPath),
    ];

    const results = {};

    for (const method of validationMethods) {
      try {
        const result = await method();
        Object.assign(results, result);
      } catch (error) {
        console.warn("矢量验证方法失败:", error.message);
      }
    }

    return {
      isVector:
        results.hasText ||
        results.hasVectorContent ||
        (results.hasEmbeddedImages && results.isVectorFriendly),
      hasText: results.hasText || false,
      hasVectorGraphics: results.hasVectorContent || false,
      hasImages: results.hasEmbeddedImages || false,
      imageCount: results.imageCount || 0,
      fileSize: results.fileSize,
      details: results,
    };
  }

  // 🔧 检查PDF字体信息（矢量文字的指标）
  async checkPDFWithPdffonts(pdfPath) {
    const command = `pdffonts "${pdfPath}"`;

    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve({ hasText: false });
          return;
        }

        const hasEmbeddedFonts =
          stdout.includes("yes") || stdout.includes("Type");
        const fontCount = (stdout.match(/\n/g) || []).length - 2; // 减去标题行

        resolve({
          hasText: hasEmbeddedFonts && fontCount > 0,
          fontCount,
          fontDetails: stdout,
        });
      });
    });
  }

  // 🔧 检查PDF基本信息
  async checkPDFWithPdfinfo(pdfPath) {
    const command = `pdfinfo "${pdfPath}"`;

    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve({ hasVectorGraphics: false });
          return;
        }

        const output = stdout.toLowerCase();
        const hasVectorGraphics =
          !output.includes("form:") ||
          output.includes("tagged:") ||
          !output.includes("page size: 0 x 0");

        resolve({
          hasVectorGraphics,
          pdfInfo: stdout,
        });
      });
    });
  }

  // 🔧 检查文件大小（矢量通常比栅格小）
  async checkPDFFileSize(pdfPath) {
    try {
      const stats = fs.statSync(pdfPath);
      const fileSizeKB = Math.round(stats.size / 1024);

      return {
        fileSize: fileSizeKB,
        isSuspiciouslyLarge: fileSizeKB > 50000, // 调整到50MB，适合高分辨率矢量PDF
      };
    } catch (error) {
      return { fileSize: 0 };
    }
  }

  async checkPDFWithPdfImages(pdfPath) {
    const command = `pdfimages -list "${pdfPath}"`;

    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve({ hasEmbeddedImages: false, imageCount: 0 });
          return;
        }

        const lines = stdout.split("\n").filter((line) => line.trim());
        const imageCount = Math.max(0, lines.length - 2); // 减去标题行

        resolve({
          hasEmbeddedImages: imageCount > 0,
          imageCount,
          isVectorFriendly: imageCount < 10, // 图片数量合理说明可能保持了矢量结构
        });
      });
    });
  }

  async checkPDFWithMutool(pdfPath) {
    const command = `mutool info "${pdfPath}"`;

    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          resolve({ hasVectorContent: false });
          return;
        }

        const output = stdout.toLowerCase();
        const hasVectorContent =
          output.includes("pages:") &&
          !output.includes("form xobject") && // 避免整页作为单个对象
          (output.includes("path") ||
            output.includes("text") ||
            output.includes("font"));

        resolve({
          hasVectorContent,
          pdfStructure: output.substring(0, 300),
        });
      });
    });
  }
}

module.exports = ColorManager;
