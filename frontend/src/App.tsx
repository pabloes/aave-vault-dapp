import React, { useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers'
import MetaMaskSDK from '@metamask/sdk'
import Countdown from './components/Countdown'
import multiTimelockAbiJson from './lib/abis/MultiTokenTimelock.json'
import multiFactoryAbiJson from './lib/abis/MultiTokenTimelockFactory.json'

const MT_ABI = (multiTimelockAbiJson as any).abi
const MT_FACTORY_ABI = (multiFactoryAbiJson as any).abi

// Aave Pool ABI for getReserveData and addresses provider accessor
const POOL_ABI = [
  "function getReserveData(address asset) external view returns (uint256, uint128, uint128, uint128, uint128, uint128, uint40, address, address, address, address, uint8)",
  "function ADDRESSES_PROVIDER() view returns (address)"
]

// AddressesProvider minimal ABI
const ADDRESSES_PROVIDER_ABI = [
  "function getPool() view returns (address)",
  "function getPoolDataProvider() view returns (address)"
]

// PoolDataProvider minimal ABI
const DATA_PROVIDER_ABI = [
  "function getAllReservesTokens() view returns (tuple(string symbol, address tokenAddress)[])"
]

// Data Provider: map asset -> aToken
const DATA_PROVIDER_ADDRESSES_ABI = [
  "function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)"
]

// Rates from Protocol Data Provider (v3): liquidityRate is at index 5 (uint256, ray)
const DATA_PROVIDER_RATES_ABI = [
  "function getReserveData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)"
]

// Convert liquidityRate (ray) to APY% with per-second compounding
function formatRayApy(rateRay: bigint): string {
  const SECONDS_PER_YEAR = 31_536_000 // 365 days
  // Avoid precision loss converting BigInt(1e27) to Number.
  // Compute apr = rateRay / 1e27 using chunked division:
  const SCALE = 1_000_000_000_000_000n // 1e15
  const rateScaled = rateRay / SCALE // up to ~1e12 range
  const apr = Number(rateScaled) / 1e12 // decimal APR
  if (!isFinite(apr) || apr < 0) return ''
  const apy = Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1
  const pct = apy * 100
  return `${pct.toFixed(2)}%`
}

// Default Aave V3 AddressesProvider by chain
const DEFAULT_ADDRESSES_PROVIDER: Record<number, string> = {
  1: '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e',       // Ethereum
  137: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',     // Polygon
  42161: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',   // Arbitrum
  10: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',      // Optimism
  8453: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',    // Base
  11155111: '0x012bAC54348C0E635dCAc49D8EF0093B445d2E'   // Sepolia (example)
}

// Selectable chains for quick switching
const CHAIN_LIST: { id: number, name: string }[] = [
  { id: 1, name: 'Ethereum' },
  { id: 137, name: 'Polygon' },
  { id: 42161, name: 'Arbitrum' },
  { id: 10, name: 'Optimism' },
  { id: 8453, name: 'Base' },
  { id: 11155111, name: 'Sepolia (testnet)' },
]

type AddChainParams = {
  chainId: string
  chainName: string
  nativeCurrency: { name: string, symbol: string, decimals: number }
  rpcUrls: string[]
  blockExplorerUrls?: string[]
}

const CHAIN_PARAMS: Record<number, AddChainParams> = {
  1: { chainId: '0x1', chainName: 'Ethereum Mainnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://cloudflare-eth.com'], blockExplorerUrls: ['https://etherscan.io'] },
  137: { chainId: '0x89', chainName: 'Polygon', nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'] },
  42161: { chainId: '0xa4b1', chainName: 'Arbitrum One', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://arb1.arbitrum.io/rpc'], blockExplorerUrls: ['https://arbiscan.io'] },
  10: { chainId: '0xa', chainName: 'OP Mainnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.optimism.io'], blockExplorerUrls: ['https://optimistic.etherscan.io'] },
  8453: { chainId: '0x2105', chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] },
  11155111: { chainId: '0xaa36a7', chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'SEP', decimals: 18 }, rpcUrls: ['https://rpc.sepolia.org'], blockExplorerUrls: ['https://sepolia.etherscan.io'] },
}

function toHexChainId(id: number): string { return '0x' + id.toString(16) }

function useProvider() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null)
  useEffect(() => {
    if ((window as any).ethereum) {
      const p = new BrowserProvider((window as any).ethereum)
      setProvider(p)
    }
  }, [])
  return provider
}

async function connectWallet(): Promise<string | null> {
  const eth = (window as any).ethereum
  try {
    if (eth) {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('injected-timeout')), 3000))
      await Promise.race([eth.request({ method: 'eth_chainId' }), timeout])
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' })
      return accounts[0] || null
    }
  } catch (e: any) {
    // fallthrough
  }

  // Fallback 1: MetaMask SDK (works on file:// via deeplink/QR)
  try {
    const sdk = new MetaMaskSDK({
      dappMetadata: { name: 'Aave Timelock Vault', url: 'https://dapp.local' },
      checkInstallationImmediately: false,
      preferDesktop: false,
      useDeeplink: true,
      enableAnalytics: false,
    })
    const mm: any = sdk.getProvider() as any
    if (!mm) throw new Error('metamask provider unavailable')
    const accounts: any = await (mm as any).request({ method: 'eth_requestAccounts' })
    ;(window as any).ethereum = mm
    return (accounts && accounts[0]) || null
  } catch (e) {
    // continue to WC
  }

  alert('Could not connect via injected provider. Opening MetaMask via deeplink/QR failed or was cancelled. Please install MetaMask or open this file on a device with MetaMask app installed and try again.')
  return null
}

function short(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}

export default function App() {
  const provider = useProvider()
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)

  const [factoryAddress, setFactoryAddress] = useState<string>('')
  const [dataProviderAddr, setDataProviderAddr] = useState<string>('')
  const [mtFactoryAddress, setMtFactoryAddress] = useState<string>('0x7800d050B10aCbf3bdcbF50D58612A6f215EA0E9')
  const [reserves, setReserves] = useState<{ symbol: string, address: string }[]>([])
  const [reserveApys, setReserveApys] = useState<Record<string, string>>({})
  const [currentApy, setCurrentApy] = useState<string>('')
  const [addressesProviderAddr, setAddressesProviderAddr] = useState<string>('')
  const [isDeployingFactory, setIsDeployingFactory] = useState<boolean>(false)
  const [isLoadingVaults, setIsLoadingVaults] = useState<boolean>(false)
  const [isCreatingVault, setIsCreatingVault] = useState<boolean>(false)
  const [loadingReserves, setLoadingReserves] = useState<boolean>(false)
  const [importedVaults, setImportedVaults] = useState<string[]>([])
  const [importInput, setImportInput] = useState<string>('')

  const [createParams, setCreateParams] = useState({ asset: '', pool: '', releaseIso: '' })
  const [createMtParams, setCreateMtParams] = useState({ releaseIso: '' })

  // Load saved settings from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('avs_settings')
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.factoryAddress) setFactoryAddress(saved.factoryAddress)
      if (saved.addressesProviderAddr) setAddressesProviderAddr(saved.addressesProviderAddr)
      if (saved.mtFactoryAddress) setMtFactoryAddress(saved.mtFactoryAddress)
      if (saved.dataProviderAddr) setDataProviderAddr(saved.dataProviderAddr)
      if (saved.createParams) setCreateParams((p) => ({ ...p, ...saved.createParams }))
    } catch {}
  }, [])

  useEffect(() => {
    const eth = (window as any).ethereum
    if (!eth) return
    eth.on('chainChanged', () => window.location.reload())
    eth.on('accountsChanged', () => window.location.reload())
    ;(async () => {
      try {
        const provider = new BrowserProvider(eth)
        const net = await provider.getNetwork()
        setChainId(Number(net.chainId))
        const def = DEFAULT_ADDRESSES_PROVIDER[Number(net.chainId)]
        if (def) setAddressesProviderAddr(def)
        try {
          const raw = localStorage.getItem(`avs_imported:${Number(net.chainId)}`)
          setImportedVaults(raw ? JSON.parse(raw) : [])
        } catch { setImportedVaults([]) }
      } catch {
        setChainId(null)
      }
    })()
  }, [])

  // Auto-load vaults when account is connected and factory address is set
  useEffect(() => {
    if (provider && account && mtFactoryAddress) {
      refreshVaults()
    }
  }, [provider, account, mtFactoryAddress])

  // When pool or addressesProvider changes, resolve -> PoolDataProvider and load reserves
  useEffect(() => {
    if (!provider) return
    ;(async () => {
      try {
        setLoadingReserves(true)
        let addressesProvider: string | null = null
        if (addressesProviderAddr) {
          addressesProvider = addressesProviderAddr
        } else if (createParams.pool) {
          const pool = new Contract(createParams.pool, POOL_ABI, provider)
          addressesProvider = await pool.ADDRESSES_PROVIDER()
        }
        if (!addressesProvider) return
        const addrProv = new Contract(addressesProvider, ADDRESSES_PROVIDER_ABI, provider)
        // Auto-fill Pool address from AddressesProvider if not set
        try {
          const poolAddrAuto: string = await addrProv.getPool()
          if (poolAddrAuto && !createParams.pool) {
            setCreateParams(p => ({ ...p, pool: poolAddrAuto }))
          }
        } catch {}
        const dp: string = await addrProv.getPoolDataProvider()
        setDataProviderAddr(dp)
        const dataProv = new Contract(dp, DATA_PROVIDER_ABI, provider)
        const list: any[] = await dataProv.getAllReservesTokens()
        const parsed = list.map((it: any) => ({ symbol: it.symbol ?? it[0], address: it.tokenAddress ?? it[1] }))
        setReserves(parsed)
        if (!createParams.asset && parsed.length > 0) {
          setCreateParams(p => ({ ...p, asset: parsed[0].address }))
        }
      } catch (e) {
        setReserves([])
        setDataProviderAddr('')
      } finally {
        setLoadingReserves(false)
      }
    })()
  }, [provider, createParams.pool, addressesProviderAddr])

  // Compute APY for selected asset (prefer Protocol Data Provider)
  useEffect(() => {
    if (!provider || !createParams.asset) return
    ;(async () => {
      try {
        let liquidityRate: bigint | null = null
        if (dataProviderAddr) {
          const dp = new Contract(dataProviderAddr, DATA_PROVIDER_RATES_ABI, provider)
          const rd: any = await dp.getReserveData(createParams.asset)
          liquidityRate = rd[5] as bigint
        }
        if (!liquidityRate) {
          const poolAddr = createParams.pool || (addressesProviderAddr ? await new Contract(addressesProviderAddr, ADDRESSES_PROVIDER_ABI, provider).getPool() : '')
          if (!poolAddr) { setCurrentApy(''); return }
          const pool = new Contract(poolAddr, POOL_ABI, provider)
          const rd: any = await pool.getReserveData(createParams.asset)
          liquidityRate = rd[3] as bigint
        }
        if (!liquidityRate) { setCurrentApy(''); return }
        setCurrentApy(formatRayApy(liquidityRate))
      } catch {
        setCurrentApy('')
      }
    })()
  }, [provider, createParams.pool, createParams.asset, addressesProviderAddr, dataProviderAddr])

  // Compute APY for all reserves to show in dropdowns
  useEffect(() => {
    if (!provider || reserves.length === 0) { setReserveApys({}); return }
    (async () => {
      try {
        let poolAddr = ''
        try {
          if (addressesProviderAddr) {
            poolAddr = await new Contract(addressesProviderAddr, ADDRESSES_PROVIDER_ABI, provider).getPool()
          } else if (createParams.pool) {
            poolAddr = createParams.pool
          }
        } catch {}
        const pool = poolAddr ? new Contract(poolAddr, POOL_ABI, provider) : null
        const dp = dataProviderAddr ? new Contract(dataProviderAddr, DATA_PROVIDER_RATES_ABI, provider) : null
        const entries = await Promise.all(reserves.map(async (r) => {
          try {
            let rate: bigint | null = null
            if (dp) {
              const rd: any = await (dp as any).getReserveData(r.address)
              rate = rd[5] as bigint
            }
            if (!rate && pool) {
              const rd2: any = await (pool as any).getReserveData(r.address)
              rate = rd2[3] as bigint
            }
            const apy = rate ? formatRayApy(rate) : ''
            return [r.address.toLowerCase(), apy] as const
          } catch {
            return [r.address.toLowerCase(), ''] as const
          }
        }))
        const map: Record<string,string> = {}
        for (const [k,v] of entries) map[k] = v
        setReserveApys(map)
      } catch {
        setReserveApys({})
      }
    })()
  }, [provider, reserves, dataProviderAddr, addressesProviderAddr, createParams.pool])

  // Persist settings to localStorage
  useEffect(() => {
    try {
      const st = { factoryAddress, addressesProviderAddr, dataProviderAddr, createParams, mtFactoryAddress }
      localStorage.setItem('avs_settings', JSON.stringify(st))
    } catch {}
  }, [factoryAddress, addressesProviderAddr, dataProviderAddr, createParams, mtFactoryAddress])

  // Persist imported vaults per-chain
  useEffect(() => {
    if (!chainId) return
    try { localStorage.setItem(`avs_imported:${chainId}`, JSON.stringify(importedVaults)) } catch {}
  }, [chainId, importedVaults])

  const [myVaults, setMyVaults] = useState<string[]>([])
  const [myTimelocks, setMyTimelocks] = useState<string[]>([])

  const factory = null as any
  const mtFactory = useMemo(() => {
    if (!provider || !mtFactoryAddress) return null
    return new Contract(mtFactoryAddress, MT_FACTORY_ABI, provider)
  }, [provider, mtFactoryAddress])

  async function handleConnect() {
    const acc = await connectWallet()
    setAccount(acc)
  }

  async function switchChain(targetId: number) {
    const eth = (window as any).ethereum
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHexChainId(targetId) }] })
    } catch (e: any) {
      if (e?.code === 4902) {
        const params = CHAIN_PARAMS[targetId]
        if (!params) return
        await eth.request({ method: 'wallet_addEthereumChain', params: [params] })
      }
    }
  }

  async function downloadThisWebApp() {
    const isDev = import.meta.env.DEV
    if (isDev) {
      try {
        const resp = await fetch('/__singlefile', { cache: 'no-store' })
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        const html = await resp.text()
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'aave-vault-app.html'
        a.click()
        URL.revokeObjectURL(url)
        return
      } catch (e) {
        alert('Failed to generate single-file in dev. Please restart dev server.')
        return
      }
    }
    const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'aave-vault-app.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function refreshVaults() {
    if (!account || !provider) return
    setIsLoadingVaults(true)
    try {
      if (factory) {
        const list: string[] = await factory.getVaultsByOwner(account)
        setMyVaults(list)
      }
      if (mtFactoryAddress) {
        try {
          const code = await provider.getCode(mtFactoryAddress)
          if (code && code !== '0x' && mtFactory) {
            const t: string[] = await (mtFactory as any).getTimelocksByOwner(account)
            setMyTimelocks(t)
          } else {
            // Not a contract on this network; clear list
            setMyTimelocks([])
          }
        } catch (e) {
          console.warn('Failed to load timelocks', e)
        }
      }
    } finally {
      setIsLoadingVaults(false)
    }
  }

  async function createVault(e: React.FormEvent) {
    e.preventDefault()
    if (!provider) return
    
    try {
      const signer = await provider.getSigner()
      const rel = Math.floor(new Date(createParams.releaseIso).getTime() / 1000)
      if (!rel || rel <= Math.floor(Date.now() / 1000)) {
        alert('Release time must be in the future')
        return
      }

      // Preflight validation: ensure pool is resolvable and supports asset
      let poolAddr = createParams.pool
      try {
        if (!poolAddr && addressesProviderAddr) {
          poolAddr = await new Contract(addressesProviderAddr, ADDRESSES_PROVIDER_ABI, provider).getPool()
        }
      } catch {}
      if (!poolAddr) {
        alert('Pool address missing or cannot be resolved from AddressesProvider')
        return
      }
      try {
        const pool = new Contract(poolAddr, POOL_ABI, provider)
        const rd: any = await pool.getReserveData(createParams.asset)
        const aTokenAddr = rd[8] || rd[9] || rd.aTokenAddress || ''
        if (!aTokenAddr || aTokenAddr === '0x0000000000000000000000000000000000000000') {
          alert('Selected Pool does not support the provided asset')
          return
        }
      } catch {
        alert('Failed to read reserve data. Check Pool and Asset addresses for this chain.')
        return
      }
      
      // Create vault without aToken parameter - factory will derive it automatically
      setIsCreatingVault(true)
      alert('Legacy Aave vault creation removed. Use multi-token timelock below.')
      
      // Keep asset and pool, clear only release date
      setCreateParams(p => ({ ...p, releaseIso: '' }))
    } catch (error: any) {
      console.log(error.message)
      alert(`Error creating vault: ${error.message}`)
    } finally {
      setIsCreatingVault(false)
    }
  }

  // Deploy & Verify features removed for MVP

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'Inter, system-ui, Arial' }}>
      <h1>Aave Timelock Vaults</h1>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={handleConnect} disabled={!!account}>{account ? short(account) : 'Connect Wallet'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Chain:</span>
          <select value={chainId ?? ''} onChange={e => { const id = Number(e.target.value); if (id) switchChain(id) }}>
            <option value="">Select</option>
            {CHAIN_LIST.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button onClick={downloadThisWebApp}>Download this web-app</button>
        {/* Desktop app button removed */}
      </div>

      <hr style={{ margin: '24px 0' }} />

      <section>
        <h2>Settings</h2>
        <div style={{ marginTop: 8 }}>
          <label>Multi-Token Timelock Factory:&nbsp;
            <input style={{ width: 420 }} value={mtFactoryAddress} onChange={e => setMtFactoryAddress(e.target.value)} placeholder="0x... (optional)" />
          </label>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <label>Addresses Provider (optional):&nbsp;
            <input style={{ width: 420 }} value={addressesProviderAddr} onChange={e => setAddressesProviderAddr(e.target.value)} placeholder="0x... (auto by chain)" />
          </label>
          <label>Pool Data Provider (auto from AddressesProvider):&nbsp;
            <input style={{ width: 420 }} value={dataProviderAddr} onChange={e => setDataProviderAddr(e.target.value)} placeholder="0x... (auto)" />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input placeholder="Import vault address" value={importInput} onChange={e => setImportInput(e.target.value)} style={{ width: 280 }} />
            <button type="button" onClick={() => {
              if (!importInput || !(importInput.startsWith('0x') && importInput.length === 42)) { alert('Invalid address'); return }
              if (importedVaults.includes(importInput)) { alert('Already added'); return }
              setImportedVaults(v => [...v, importInput])
              setImportInput('')
            }}>Add</button>
          </div>
        </div>
      </section>

      <hr style={{ margin: '24px 0' }} />

      {/* Legacy Create Vault removed */}

      <section>
        <h2>Create Timelock (multi-token)</h2>
        <form onSubmit={async (e) => {
          e.preventDefault()
          if (!provider || !mtFactory) return
          const signer = await provider.getSigner()
          const rel = Math.floor(new Date(createMtParams.releaseIso).getTime() / 1000)
          if (!rel || rel <= Math.floor(Date.now() / 1000)) { alert('Release time must be in the future'); return }
          if (!addressesProviderAddr) { alert('AddressesProvider required to sweep all aTokens'); return }
          const tx = await (mtFactory as any).connect(signer).createTimelock(addressesProviderAddr, rel)
          await tx.wait()
          setCreateMtParams({ releaseIso: '' })
          await refreshVaults()
        }} style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
          <QuickDatePicker value={createMtParams.releaseIso} onChange={(v) => setCreateMtParams({ releaseIso: v })} />
          <button type="submit" disabled={!mtFactory || !account}>Create Timelock</button>
        </form>
      </section>

      <hr style={{ margin: '24px 0' }} />

      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0 }}>My Vaults</h2>
          <button onClick={refreshVaults} disabled={!account || isLoadingVaults}>Load My Vaults{isLoadingVaults ? '…' : ''}</button>
        </div>
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          {(() => { const all = Array.from(new Set([...(importedVaults||[]), ...myVaults, ...myTimelocks])); return all.length === 0 ? <div>No vaults found.</div> : all.map(addr => (
            <div key={addr} style={{ position: 'relative' }}>
              {importedVaults.includes(addr) && (
                <button
                  style={{ position: 'absolute', right: 8, top: 8 }}
                  onClick={() => setImportedVaults(v => v.filter(x => x !== addr))}
                  title="Remove imported vault"
                >Remove</button>
              )}
              <VaultCard
                vaultAddress={addr}
                provider={provider}
                reserves={reserves}
                addressesProviderAddr={addressesProviderAddr}
                dataProviderAddr={dataProviderAddr}
                reserveApys={reserveApys}
              />
            </div>
          )) })()}
        </div>
      </section>
    </div>
  )
}

function PositionCell({ provider, vaultAddress, asset, decimalsHint }: { provider: BrowserProvider | null, vaultAddress: string, asset: string, decimalsHint: number }) {
  const [text, setText] = useState<string>('…')
  useEffect(() => {
    if (!provider) return
    ;(async () => {
      try {
        const tl = new Contract(vaultAddress, MT_ABI, provider)
        const [principal] = await (tl as any).getPosition(asset)
        setText(formatUnits(principal, decimalsHint))
      } catch { setText('—') }
    })()
  }, [provider, vaultAddress, asset, decimalsHint])
  return <span>{text}</span>
}

function GrowthCell({ provider, vaultAddress, asset }: { provider: BrowserProvider | null, vaultAddress: string, asset: string }) {
  const [text, setText] = useState<string>('')
  useEffect(() => {
    if (!provider) return
    ;(async () => {
      try {
        const tl = new Contract(vaultAddress, MT_ABI, provider)
        const [, , growthBps] = await (tl as any).getPosition(asset)
        const bps = Number(growthBps)
        const pct = (bps / 100).toFixed(2) + '%'
        setText(pct)
      } catch { setText('') }
    })()
  }, [provider, vaultAddress, asset])
  return <span>{text}</span>
}
function QuickDatePicker({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  function toLocalIso(dt: Date) {
    return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0,16)
  }
  function setOffsetDays(days: number) {
    const base = value ? new Date(value) : new Date()
    base.setDate(base.getDate() + days)
    onChange(toLocalIso(base))
  }
  function setOffsetYears(years: number) {
    const base = value ? new Date(value) : new Date()
    base.setFullYear(base.getFullYear() + years)
    onChange(toLocalIso(base))
  }
  function formatRelativeText(val: string): string {
    if (!val) return 'Select a release date.'
    const target = new Date(val)
    const now = new Date()
    const ms = target.getTime() - now.getTime()
    const abs = Math.abs(ms)
    const minutes = Math.floor(abs / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    const remDays = Math.floor((days % 365) % 30)
    let span = ''
    if (years > 0) span += `${years} year${years === 1 ? '' : 's'}`
    if (months > 0) span += `${span ? ' ' : ''}${months} month${months === 1 ? '' : 's'}`
    if (!span && days > 0) span = `${days} day${days === 1 ? '' : 's'}`
    if (!span && hours > 0) span = `${hours} hour${hours === 1 ? '' : 's'}`
    if (!span) span = `${minutes} minute${minutes === 1 ? '' : 's'}`
    const when = target.toLocaleString()
    return ms >= 0 ? `Releases on ${when} (in ${span})` : `Release time passed (${span} ago) • ${when}`
  }
  useEffect(() => {
    if (!value) {
      const now = new Date()
      onChange(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16))
    }
  }, [])
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOffsetDays(30)}>+1 month</button>
        <button type="button" onClick={() => setOffsetDays(7)}>+7 days</button>
        <button type="button" onClick={() => setOffsetYears(1)}>+1 year</button>
        <button type="button" onClick={() => setOffsetYears(5)}>+5 years</button>
      </div>
      <div style={{ fontSize: 12, color: '#666' }}>{formatRelativeText(value)}</div>
    </div>
  )
}

function VaultCard({ vaultAddress, provider, reserves, addressesProviderAddr, dataProviderAddr, reserveApys }: { vaultAddress: string, provider: BrowserProvider | null, reserves: {symbol:string, address:string}[], addressesProviderAddr: string, dataProviderAddr: string, reserveApys: Record<string,string> }) {
  const [info, setInfo] = useState<{ releaseTime: number } | null>(null)
  const [amount, setAmount] = useState<string>('')
  const [tokenToDeposit, setTokenToDeposit] = useState<string>('')
  const [tokenToSweep, setTokenToSweep] = useState<string>('')
  const [balance, setBalance] = useState<string>('')
  const [percent, setPercent] = useState<string>('100')
  const [walletBal, setWalletBal] = useState<bigint>(0n)
  const [newReleaseIso, setNewReleaseIso] = useState<string>('')
  
  // Ownership (MultiTokenTimelock only)
  const [ownerAddr, setOwnerAddr] = useState<string>('')
  const [pendingOwner, setPendingOwner] = useState<string>('')
  const [newOwner, setNewOwner] = useState<string>('')
  const [isTransferringOwner, setIsTransferringOwner] = useState<boolean>(false)
  const [isAcceptingOwner, setIsAcceptingOwner] = useState<boolean>(false)

  const [decimals, setDecimals] = useState<number>(18)
  const [isDepositing, setIsDepositing] = useState<boolean>(false)
  const [heldATokens, setHeldATokens] = useState<{ symbol: string, asset: string, aToken?: string, balance: string, apy?: string, kind: 'aToken' | 'underlying' }[]>([])
  const [isExtending, setIsExtending] = useState<boolean>(false)

  useEffect(() => {
    if (!provider) return
    ;(async () => {
      try {
        const mt = new Contract(vaultAddress, MT_ABI, provider)
        const releaseTime: bigint = await mt.releaseTime()
        setInfo({ releaseTime: Number(releaseTime) })
        setDecimals(18)
        try {
          const o: string = await (mt as any).owner()
          const p: string = await (mt as any).pendingOwner()
          setOwnerAddr(o)
          setPendingOwner(p)
        } catch {}
        return
      } catch {}
      setInfo(null)
    })()
  }, [provider, vaultAddress])

  async function refreshBalance() { return }
  // Refresh wallet balance for selected token (owner's balance) and set decimals appropriately
  useEffect(() => {
    if (!provider) return
    ;(async () => {
      try {
        const signer = await provider.getSigner()
        const owner = await signer.getAddress()
        let tokenAddr: string | null = null
        {
          tokenAddr = tokenToDeposit || null
        }
        if (!tokenAddr) return
        const erc20 = new Contract(tokenAddr, [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)"
        ], provider)
        const tdec: number = Number(await (erc20 as any).decimals())
        const bal: bigint = await (erc20 as any).balanceOf(owner)
        setWalletBal(bal)
        setDecimals(tdec)
      } catch {}
    })()
  }, [provider, tokenToDeposit])

  function setPercentAmount() {
    const p = Math.max(0, Math.min(100, parseInt(percent || '0', 10)))
    if (!Number.isFinite(p)) return
    // amount = walletBal * p / 100
    const target = (walletBal * BigInt(p)) / 100n
    setAmount(formatUnits(target, decimals))
  }


  function formatRelativeRelease(tsSeconds: number): string {
    const now = new Date()
    const target = new Date(tsSeconds * 1000)
    const ms = target.getTime() - now.getTime()
    const abs = Math.abs(ms)
    const minutes = Math.floor(abs / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    const remDays = Math.floor((days % 365) % 30)
    let span = ''
    if (years > 0) span += `${years} year${years === 1 ? '' : 's'}`
    if (months > 0) span += `${span ? ' ' : ''}${months} month${months === 1 ? '' : 's'}`
    if (!span && days > 0) span = `${days} day${days === 1 ? '' : 's'}`
    if (!span && hours > 0) span = `${hours} hour${hours === 1 ? '' : 's'}`
    if (!span) span = `${minutes} minute${minutes === 1 ? '' : 's'}`
    const when = target.toLocaleString()
    return ms >= 0 ? `Releases on ${when} (in ${span})` : `Release time passed (${span} ago) • ${when}`
  }

  function getTokenLabel(addr: string): string {
    const found = reserves.find(r => r.address.toLowerCase() === (addr||'').toLowerCase())
    return found ? `${found.symbol} (${found.address})` : addr
  }


  useEffect(() => { refreshBalance() }, [info])

  async function fetchHeldTokens() {
    if (!provider || !vaultAddress || !dataProviderAddr || reserves.length === 0) { setHeldATokens([]); return }
    try {
      const dp = new Contract(dataProviderAddr, DATA_PROVIDER_ADDRESSES_ABI, provider)
      const results: { symbol: string, asset: string, aToken?: string, balance: string, apy?: string, kind: 'aToken' | 'underlying' }[] = []
      for (const r of reserves) {
        try {
          const [aTokenAddr] = await (dp as any).getReserveTokensAddresses(r.address)
          if (!aTokenAddr || aTokenAddr === '0x0000000000000000000000000000000000000000') continue
          // aToken balance
          const erc20a = new Contract(aTokenAddr, ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider)
          const balA: bigint = await (erc20a as any).balanceOf(vaultAddress)
          if (balA > 0n) {
            const decA = Number(await (erc20a as any).decimals())
            const apy = reserveApys[r.address.toLowerCase()]
            results.push({ symbol: r.symbol, asset: r.address, aToken: aTokenAddr, balance: formatUnits(balA, decA), apy, kind: 'aToken' })
          }
          // underlying balance
          const erc20u = new Contract(r.address, ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider)
          const balU: bigint = await (erc20u as any).balanceOf(vaultAddress)
          if (balU > 0n) {
            const decU = Number(await (erc20u as any).decimals())
            results.push({ symbol: r.symbol, asset: r.address, balance: formatUnits(balU, decU), kind: 'underlying' })
          }
        } catch { /* skip */ }
      }
      setHeldATokens(results)
    } catch {
      setHeldATokens([])
    }
  }

  // Discover and list all aTokens held by the vault (from Aave reserves)
  useEffect(() => { fetchHeldTokens() }, [provider, vaultAddress, dataProviderAddr, reserves, reserveApys])

  async function approveAndDeposit(e: React.FormEvent) {
    e.preventDefault()
    if (!provider || !info) return
    const signer = await provider.getSigner()
    if (!tokenToDeposit || !(tokenToDeposit.startsWith('0x') && tokenToDeposit.length === 42)) { alert('Token address invalid'); return }
    const erc20 = new Contract(tokenToDeposit, [
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function decimals() view returns (uint8)"
    ], provider)
    const tdec = await (erc20 as any).decimals()
    const amt = parseUnits(amount || '0', Number(tdec))
    if (amt === 0n) return
    // Confirm dialog
    const tokenLabel = getTokenLabel(tokenToDeposit)
    const relAbs = new Date(info.releaseTime * 1000).toLocaleString()
    const relRel = formatRelativeRelease(info.releaseTime)
    const ok = window.confirm(`You are about to deposit into Aave via Timelock:\n\nToken: ${tokenLabel}\nAmount: ${amount}\n\nRelease time: ${relAbs}\n${relRel}\n\nProceed?`)
    if (!ok) return
    // Approve timelock to pull tokens if needed, then call deposit (pool auto-resolved if zero)
    const owner = await signer.getAddress()
    const current: bigint = await (erc20 as any).allowance(owner, vaultAddress)
    if (current < amt) {
      const MAX = (1n << 256n) - 1n
      const approveTx = await (erc20 as any).connect(signer).approve(vaultAddress, MAX)
      await approveTx.wait()
    }
    const mt = new Contract(vaultAddress, MT_ABI, provider)
    const zero = '0x0000000000000000000000000000000000000000'
    const depTx = await (mt as any).connect(signer).deposit(tokenToDeposit, zero, amt)
    await depTx.wait()
    setAmount('')
    await fetchHeldTokens()
    return
  }

  async function withdrawAll() {
    if (!provider || !info) return
    const signer = await provider.getSigner()
    const mt = new Contract(vaultAddress, MT_ABI, provider)
    const now = Math.floor(Date.now() / 1000)
    const release: number = info.releaseTime
    if (now < release) {
      alert('Vault is still locked')
      return
    }
    const tx = await (mt as any).connect(signer).sweepAllATokensAfterRelease(await signer.getAddress())
    await tx.wait()
    return
  }

  async function sweepATokens() {
    if (!provider || !info) return
    const signer = await provider.getSigner()
    const mt = new Contract(vaultAddress, MT_ABI, provider)
    const now = Math.floor(Date.now() / 1000)
    const release: number = info.releaseTime
    if (now < release) {
      alert('Vault is still locked')
      return
    }
    const tx = await (mt as any).connect(signer).sweepAllATokensAfterRelease(await signer.getAddress())
    await tx.wait()
    return
  }

  async function withdrawPartial() {
    if (!provider || !info) return
    const signer = await provider.getSigner()
    const vault = new Contract(vaultAddress, MT_ABI, provider)
    const now = Math.floor(Date.now() / 1000)
    const release: number = info.releaseTime
    if (now < release) {
      alert('Vault is still locked')
      return
    }
    const amt = parseUnits(amount || '0', decimals)
    if (amt === 0n) return
    const tx = await (vault as any).connect(signer).withdraw(amt, await signer.getAddress())
    await tx.wait()
    setAmount('')
    await refreshBalance()
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{vaultAddress}</strong>
        {info && <Countdown target={info.releaseTime} />}
      </div>
      <div style={{ display: 'grid', gap: 6, marginTop: 8, fontSize: 14 }}>
        <div>Type: Multi-Token Timelock</div>
        {info && <div>Release time: {new Date(info.releaseTime * 1000).toLocaleString()}</div>}
      </div>

      <form onSubmit={approveAndDeposit} style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tokenToDeposit} onChange={e => setTokenToDeposit(e.target.value)} style={{ minWidth: 380 }}>
          <option value="">Select token to deposit</option>
          {reserves.map(r => {
            const apy = reserveApys[r.address.toLowerCase()] || ''
            const label = apy ? `${r.symbol} • ${apy}` : r.symbol
            return <option key={r.address} value={r.address}>{label} ({r.address})</option>
          })}
        </select>
        <input placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} disabled={isDepositing} />
        <input style={{ width: 64 }} value={percent} onChange={e => setPercent(e.target.value)} />
        <span>%</span>
        <button type="button" onClick={setPercentAmount}>Set % amount</button>
        <button type="submit" disabled={isDepositing}>{isDepositing ? 'Processing…' : 'Transfer to Timelock'}</button>
      </form>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={withdrawPartial}>Withdraw</button>
        <button onClick={withdrawAll}>Withdraw All</button>
        <button onClick={sweepATokens}>Sweep ALL aTokens</button>
        <>
          <input placeholder="Sweep token address" value={tokenToSweep} onChange={e => setTokenToSweep(e.target.value)} style={{ width: 260 }} />
          <button onClick={async () => {
            if (!provider || !info) return
            const signer = await provider.getSigner()
            const now = Math.floor(Date.now() / 1000)
            if (now < (info?.releaseTime || 0)) { alert('Vault is still locked'); return }
            if (!tokenToSweep || !(tokenToSweep.startsWith('0x') && tokenToSweep.length === 42)) { alert('Token address invalid'); return }
            const mt = new Contract(vaultAddress, MT_ABI, provider)
            const tx = await (mt as any).connect(signer).sweepTokenAfterRelease(tokenToSweep, await signer.getAddress())
            await tx.wait()
            setTokenToSweep('')
          }}>Sweep token</button>
        </>
      </div>
 
      {/* Ownership (only for MultiTokenTimelock) */}
      {true && (
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          <div style={{ fontWeight: 600 }}>Ownership</div>
          <div>Owner: {ownerAddr || '—'}</div>
          {pendingOwner && pendingOwner !== '0x0000000000000000000000000000000000000000' && (
            <div>Pending owner: {pendingOwner}</div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input placeholder="New owner address" value={newOwner} onChange={e => setNewOwner(e.target.value)} style={{ width: 320 }} />
            <button type="button" disabled={isTransferringOwner} onClick={async () => {
              if (!provider || !newOwner) return
              if (!(newOwner.startsWith('0x') && newOwner.length === 42)) { alert('Invalid address'); return }
              setIsTransferringOwner(true)
              try {
                const signer = await provider.getSigner()
                const mt = new Contract(vaultAddress, MT_ABI, provider)
                const tx = await (mt as any).connect(signer).transferOwnership(newOwner)
                await tx.wait()
                setNewOwner('')
                // refresh ownership info
                const o: string = await (mt as any).owner()
                const p: string = await (mt as any).pendingOwner()
                setOwnerAddr(o)
                setPendingOwner(p)
              } finally {
                setIsTransferringOwner(false)
              }
            }}>{isTransferringOwner ? 'Starting…' : 'Start transfer'}</button>
            <button type="button" disabled={isAcceptingOwner} onClick={async () => {
              if (!provider) return
              setIsAcceptingOwner(true)
              try {
                const signer = await provider.getSigner()
                const mt = new Contract(vaultAddress, MT_ABI, provider)
                const tx = await (mt as any).connect(signer).acceptOwnership()
                await tx.wait()
                // refresh ownership info
                const o: string = await (mt as any).owner()
                const p: string = await (mt as any).pendingOwner()
                setOwnerAddr(o)
                setPendingOwner(p)
              } finally {
                setIsAcceptingOwner(false)
              }
            }}>{isAcceptingOwner ? 'Accepting…' : 'Accept ownership'}</button>
          </div>
        </div>
      )}
 
      {/* Extend lock */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="datetime-local" value={newReleaseIso} onChange={e => setNewReleaseIso(e.target.value)} />
        <button type="button" disabled={isExtending || !newReleaseIso} onClick={async () => {
          if (!provider || !info) return
          const ts = Math.floor(new Date(newReleaseIso).getTime() / 1000)
          if (!ts || ts <= (info.releaseTime || 0)) { alert('New release must be greater than current'); return }
          setIsExtending(true)
          try {
            const signer = await provider.getSigner()
            const mt = new Contract(vaultAddress, MT_ABI, provider)
            const tx = await (mt as any).connect(signer).extendLock(ts)
            await tx.wait()
            setNewReleaseIso('')
            // refresh local release time
            setInfo(prev => prev ? { ...prev, releaseTime: ts } : prev)
          } finally {
            setIsExtending(false)
          }
        }}>{isExtending ? 'Extending…' : 'Extend lock'}</button>
        {newReleaseIso && (
          <div style={{ fontSize: 12, color: '#666' }}>
            {formatRelativeRelease(Math.floor(new Date(newReleaseIso).getTime() / 1000))}
          </div>
        )}
      </div>
 
      {/* Held tokens summary */}
      {heldATokens.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600 }}>Tokens held by vault</div>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '4px 6px' }}>Token</th>
                <th style={{ padding: '4px 6px' }}>Principal</th>
                <th style={{ padding: '4px 6px' }}>Withdrawable</th>
                <th style={{ padding: '4px 6px' }}>Growth</th>
                <th style={{ padding: '4px 6px' }}>APY</th>
              </tr>
            </thead>
            <tbody>
              {heldATokens.map((t) => {
                if (t.kind !== 'aToken') return (
                  <tr key={(t.aToken||t.asset)+t.kind}>
                    <td style={{ padding: '4px 6px' }}>{t.symbol} (underlying)</td>
                    <td style={{ padding: '4px 6px' }}>—</td>
                    <td style={{ padding: '4px 6px' }}>{t.balance}</td>
                    <td style={{ padding: '4px 6px' }}>—</td>
                    <td style={{ padding: '4px 6px' }}>{t.apy || ''}</td>
                  </tr>
                )
                return (
                  <tr key={(t.aToken||t.asset)+t.kind}>
                    <td style={{ padding: '4px 6px' }}>{t.symbol}</td>
                    <td style={{ padding: '4px 6px' }} data-token={t.asset}>
                      {/* principal via getPosition */}
                      <PositionCell provider={provider} vaultAddress={vaultAddress} asset={t.asset} decimalsHint={decimals} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>{t.balance}</td>
                    <td style={{ padding: '4px 6px' }}>
                      <GrowthCell provider={provider} vaultAddress={vaultAddress} asset={t.asset} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>{t.apy || ''}</td>
                    <td style={{ padding: '4px 6px' }}>
                      <button onClick={async () => {
                        if (!provider || !info) return
                        const signer = await provider.getSigner()
                        const now = Math.floor(Date.now() / 1000)
                        if (now < (info?.releaseTime || 0)) { alert('Vault is still locked'); return }
                        const mt = new Contract(vaultAddress, MT_ABI, provider)
                        const tx = await (mt as any).connect(signer).withdrawAllUnderlying(t.asset, await signer.getAddress())
                        await tx.wait()
                        await refreshBalance()
                        await fetchHeldTokens()
                      }}>Withdraw All</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
