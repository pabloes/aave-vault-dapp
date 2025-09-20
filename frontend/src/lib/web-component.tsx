import { mountAaveVaultApp } from './mount'

export function defineAaveVaultElement(tag = 'aave-vault-app') {
  if (customElements.get(tag)) return
  class AaveVaultElement extends HTMLElement {
    private cleanup?: () => void
    connectedCallback() {
      this.style.display = 'block'
      this.cleanup = mountAaveVaultApp(this)
    }
    disconnectedCallback() {
      this.cleanup?.()
    }
  }
  customElements.define(tag, AaveVaultElement)
}


