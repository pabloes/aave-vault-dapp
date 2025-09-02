# 🏦 Aave Vault DApp

Una aplicación descentralizada completa para crear y gestionar vaults con timelock en Aave V3, incluyendo una aplicación de escritorio Electron.

## ✨ Características

### 🔒 Smart Contracts
- **VaultFactory**: Factory para crear vaults de Aave V3
- **TimelockAaveVault**: Vault con timelock para depósitos y retiros
- **Mock Contracts**: Contratos de prueba para desarrollo

### 🌐 Frontend Web
- **React 18** con TypeScript
- **Vite** para desarrollo rápido
- **UI moderna** y responsive
- **Integración con wallets**

### 🖥️ Aplicación Desktop
- **Electron** para aplicación nativa
- **Icono personalizado** con diseño profesional
- **Multiplataforma** (macOS, Windows, Linux)
- **Interfaz web integrada**

## 🚀 Instalación

### Prerrequisitos
- Node.js 18+
- npm o yarn
- Git

### Clonar el repositorio
```bash
git clone <tu-repositorio-url>
cd cursor-aave-vault
```

## 📦 Estructura del Proyecto

```
aave-vault-dapp/
├── contracts/          # Smart contracts y tests
│   ├── contracts/      # Contratos Solidity
│   ├── test/          # Tests con Hardhat
│   └── scripts/       # Scripts de deployment
├── frontend/           # Aplicación React
│   ├── src/           # Código fuente
│   └── dist/          # Build de producción
└── desktop/            # Aplicación Electron
    ├── assets/         # Iconos y recursos
    └── scripts/        # Scripts de build
```

## 🔧 Desarrollo

### Smart Contracts
```bash
cd aave-vault-dapp/contracts
npm install
npm run compile
npm run test
```

### Frontend Web
```bash
cd aave-vault-dapp/frontend
npm install
npm run dev
```

### Aplicación Desktop
```bash
cd aave-vault-dapp/desktop
npm install
npm run dev          # Desarrollo
npm run build        # Build de producción
```

## 🧪 Testing

### Tests de Smart Contracts
```bash
cd aave-vault-dapp/contracts
npm run test
npm run test:coverage
npm run test:gas
```

## 🏗️ Build

### Frontend
```bash
cd aave-vault-dapp/frontend
npm run build
```

### Desktop App
```bash
cd aave-vault-dapp/desktop
npm run build        # Build para todas las plataformas
npm run build:mac    # Solo macOS
npm run build:win    # Solo Windows
npm run build:linux  # Solo Linux
```

## 🎨 Iconos

El proyecto incluye un sistema de generación de iconos personalizado:

```bash
cd aave-vault-dapp/desktop
npm run generate-icons
```

### Icono Personalizado
- **Mano blanca** sosteniendo un candado
- **Letra "A"** prominente en el candado
- **Fondo degradado** púrpura a azul teal
- **Diseño moderno** y profesional

## 📱 Plataformas Soportadas

### Desktop
- ✅ macOS (ARM64, Intel)
- ✅ Windows (ARM64, x64)
- ✅ Linux (ARM64, x64)

### Web
- ✅ Chrome/Chromium
- ✅ Firefox
- ✅ Safari
- ✅ Edge

## 🔐 Seguridad

- **nodeIntegration: false** en Electron
- **Context isolation** habilitado
- **Web security** activado
- **Mock contracts** para testing seguro

## 📄 Licencia

MIT License - ver [LICENSE](LICENSE) para más detalles.

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📞 Contacto

- **Proyecto**: [Aave Vault DApp](https://github.com/tu-usuario/cursor-aave-vault)
- **Issues**: [GitHub Issues](https://github.com/tu-usuario/cursor-aave-vault/issues)

---

⭐ **¡Si te gusta este proyecto, dale una estrella!**
