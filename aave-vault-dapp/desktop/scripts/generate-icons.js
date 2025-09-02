const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Icon sizes needed for different platforms
const iconSizes = {
  mac: [16, 32, 64, 128, 256, 512, 1024],
  win: [16, 32, 48, 64, 128, 256],
  linux: [16, 32, 48, 64, 128, 256, 512]
};

async function generateIcons() {
  const svgPath = path.join(__dirname, '../assets/icon.svg');
  const outputDir = path.join(__dirname, '../assets/icons');
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('🔄 Converting SVG to PNG icons...');
  
  try {
    // Generate icons for each platform
    for (const [platform, sizes] of Object.entries(iconSizes)) {
      console.log(`📱 Generating ${platform} icons...`);
      
      for (const size of sizes) {
        const outputPath = path.join(outputDir, `${platform}-${size}x${size}.png`);
        
        await sharp(svgPath)
          .resize(size, size)
          .png()
          .toFile(outputPath);
        
        console.log(`  ✅ ${size}x${size} created`);
      }
    }
    
    // Generate icns for macOS
    console.log('🍎 Generating macOS .icns file...');
    const icnsPath = path.join(__dirname, '../assets/icon.icns');
    await sharp(svgPath)
      .resize(1024, 1024)
      .png()
      .toFile(icnsPath);
    
    // Generate ico for Windows
    console.log('🪟 Generating Windows .ico file...');
    const icoPath = path.join(__dirname, '../assets/icon.ico');
    await sharp(svgPath)
      .resize(256, 256)
      .png()
      .toFile(icoPath);
    
    console.log('🎉 All icons generated successfully!');
    console.log('📁 Icons saved in: assets/icons/');
    console.log('🍎 macOS icon: assets/icon.icns');
    console.log('🪟 Windows icon: assets/icon.ico');
    
  } catch (error) {
    console.error('❌ Error generating icons:', error);
  }
}

generateIcons();
