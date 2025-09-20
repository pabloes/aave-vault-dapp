import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import App from '../App'

let rootByElement = new WeakMap<Element, Root>()

export function mountAaveVaultApp(container: Element) {
  let root = rootByElement.get(container)
  if (!root) {
    root = createRoot(container)
    rootByElement.set(container, root)
  }
  root.render(React.createElement(App))
  return () => {
    root?.unmount()
    rootByElement.delete(container)
  }
}


