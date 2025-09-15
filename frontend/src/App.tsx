import React, { useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, ContractFactory, formatUnits, parseUnits } from 'ethers'
import MetaMaskSDK from '@metamask/sdk'
import Countdown from './components/Countdown'
import vaultAbiJson from './lib/abis/TimelockAaveVault.json'
import factoryAbiJson from './lib/abis/VaultFactory.json'

const VAULT_ABI = (vaultAbiJson as any).abi
const FACTORY_ABI = (factoryAbiJson as any).abi
const FACTORY_BYTECODE = (factoryAbiJson as any).bytecode || ''

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
  const [reserves, setReserves] = useState<{ symbol: string, address: string }[]>([])
  const [currentApy, setCurrentApy] = useState<string>('')
  const [addressesProviderAddr, setAddressesProviderAddr] = useState<string>('')
  const [verifyAfterDeploy, setVerifyAfterDeploy] = useState<boolean>(false)
  const [explorerApiKey, setExplorerApiKey] = useState<string>('')

  const [createParams, setCreateParams] = useState({
    asset: '',
    pool: '',
    releaseIso: ''
  })

  // Load saved settings from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('avs_settings')
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved.factoryAddress) setFactoryAddress(saved.factoryAddress)
      if (saved.addressesProviderAddr) setAddressesProviderAddr(saved.addressesProviderAddr)
      if (saved.dataProviderAddr) setDataProviderAddr(saved.dataProviderAddr)
      if (saved.createParams) setCreateParams((p) => ({ ...p, ...saved.createParams }))
      if (typeof saved.verifyAfterDeploy === 'boolean') setVerifyAfterDeploy(saved.verifyAfterDeploy)
      if (saved.explorerApiKey) setExplorerApiKey(saved.explorerApiKey)
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
      } catch {
        setChainId(null)
      }
    })()
  }, [])

  // When pool or addressesProvider changes, resolve -> PoolDataProvider and load reserves
  useEffect(() => {
    if (!provider) return
    ;(async () => {
      try {
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

  // Persist settings to localStorage
  useEffect(() => {
    try {
      const st = { factoryAddress, addressesProviderAddr, dataProviderAddr, createParams, verifyAfterDeploy, explorerApiKey }
      localStorage.setItem('avs_settings', JSON.stringify(st))
    } catch {}
  }, [factoryAddress, addressesProviderAddr, dataProviderAddr, createParams, verifyAfterDeploy, explorerApiKey])

  const [myVaults, setMyVaults] = useState<string[]>([])

  const factory = useMemo(() => {
    if (!provider || !factoryAddress) return null
    return new Contract(factoryAddress, FACTORY_ABI, provider)
  }, [provider, factoryAddress])

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
    if (!factory || !account) return
    const list: string[] = await factory.getVaultsByOwner(account)
    setMyVaults(list)
  }

  async function createVault(e: React.FormEvent) {
    e.preventDefault()
    if (!factory || !provider) return
    
    try {
      const signer = await provider.getSigner()
      const rel = Math.floor(new Date(createParams.releaseIso).getTime() / 1000)
      if (!rel || rel <= Math.floor(Date.now() / 1000)) {
        alert('Release time must be in the future')
        return
      }
      
      // Create vault without aToken parameter - factory will derive it automatically
      const tx = await (factory as any).connect(signer).createVault(createParams.asset, createParams.pool, rel)
      await tx.wait()
      await refreshVaults()
      
      // Keep asset and pool, clear only release date
      setCreateParams(p => ({ ...p, releaseIso: '' }))
    } catch (error: any) {
      alert(`Error creating vault: ${error.message}`)
    }
  }

  async function deployFactory() {
    if (!provider) return
    if (!FACTORY_BYTECODE) {
      alert('Factory bytecode missing in ABI json')
      return
    }
    try {
      const signer = await provider.getSigner()
      const cf = new ContractFactory(FACTORY_ABI as any, FACTORY_BYTECODE, signer)
      const contract = await cf.deploy()
      await contract.waitForDeployment()
      const addr = await contract.getAddress()
      setFactoryAddress(addr)
      alert(`Factory deployed at ${addr}`)

      if (verifyAfterDeploy) {
        try {
          const net = await provider.getNetwork()
          const id = Number(net.chainId)
          const networkName = (id === 1 ? 'mainnet' : id === 11155111 ? 'sepolia' : id === 137 ? 'polygon' : id === 42161 ? 'arbitrum' : id === 10 ? 'optimism' : id === 8453 ? 'base' : '')
          const envVar = (id === 1 || id === 11155111) ? 'ETHERSCAN_API_KEY' : id === 137 ? 'POLYGONSCAN_API_KEY' : id === 42161 ? 'ARBISCAN_API_KEY' : id === 10 ? 'OPTIMISM_ETHERSCAN_API_KEY' : id === 8453 ? 'BASESCAN_API_KEY' : ''
          if (!networkName || !envVar) {
            alert('Verification helper: this network is not mapped for auto command. Please verify manually.')
          } else if (!explorerApiKey) {
            alert('Verification helper: please provide an Explorer API key in Settings.')
          } else {
            const cmd = `${envVar}=${explorerApiKey} npx hardhat verify --network ${networkName} ${addr}`
            try { await navigator.clipboard.writeText(cmd) } catch {}
            alert(`Verification command copied to clipboard:\n\n${cmd}`)
          }
        } catch {}
      }
    } catch (e: any) {
      alert(`Deploy failed: ${e.message}`)
    }
  }

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
        <label>Factory Address:&nbsp;
          <input style={{ width: 420 }} value={factoryAddress} onChange={e => setFactoryAddress(e.target.value)} placeholder="0x..." />
        </label>
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <label>Addresses Provider (optional):&nbsp;
            <input style={{ width: 420 }} value={addressesProviderAddr} onChange={e => setAddressesProviderAddr(e.target.value)} placeholder="0x... (auto by chain)" />
          </label>
          <label>Pool Data Provider (auto from AddressesProvider):&nbsp;
            <input style={{ width: 420 }} value={dataProviderAddr} onChange={e => setDataProviderAddr(e.target.value)} placeholder="0x... (auto)" />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={verifyAfterDeploy} onChange={e => setVerifyAfterDeploy(e.target.checked)} /> Verify after deploy
          </label>
          {verifyAfterDeploy && (
            <label>Explorer API Key (for verification):&nbsp;
              <input style={{ width: 420 }} value={explorerApiKey} onChange={e => setExplorerApiKey(e.target.value)} placeholder="Etherscan/Polygonscan/etc API key" />
            </label>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={refreshVaults} disabled={!factory || !account}>Load My Vaults</button>
          <button onClick={deployFactory} disabled={!account}>Deploy Factory</button>
        </div>
      </section>

      <hr style={{ margin: '24px 0' }} />

      <section>
        <h2>Create Vault</h2>
        <form onSubmit={createVault} style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
          {reserves.length > 0 ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <select
                value={createParams.asset}
                onChange={e => setCreateParams(p => ({ ...p, asset: e.target.value }))}
              >
                {reserves.map(r => (
                  <option key={r.address} value={r.address}>{r.symbol} ({r.address})</option>
                ))}
              </select>
              {currentApy && <div style={{ fontSize: 12, color: '#666' }}>APY actual: {currentApy}</div>}
            </div>
          ) : (
            <>
              <input placeholder="Underlying token (ERC20) address" value={createParams.asset} onChange={e => setCreateParams(p => ({ ...p, asset: e.target.value }))} />
              {currentApy && <div style={{ fontSize: 12, color: '#666' }}>APY actual: {currentApy}</div>}
            </>
          )}
          <input placeholder="Aave V3 Pool address (auto from AddressesProvider)" value={createParams.pool} onChange={e => setCreateParams(p => ({ ...p, pool: e.target.value }))} />
          <QuickDatePicker value={createParams.releaseIso} onChange={(v) => setCreateParams(p => ({ ...p, releaseIso: v }))} />
          <button type="submit" disabled={!factory || !account}>Create Vault</button>
        </form>
        <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
          💡 The aToken address is automatically derived from the pool - no need to provide it!
        </p>
      </section>

      <hr style={{ margin: '24px 0' }} />

      <section>
        <h2>My Vaults</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          {myVaults.length === 0 && <div>No vaults found.</div>}
          {myVaults.map(addr => (
            <VaultCard key={addr} vaultAddress={addr} provider={provider} />
          ))}
        </div>
      </section>
    </div>
  )
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

function VaultCard({ vaultAddress, provider }: { vaultAddress: string, provider: BrowserProvider | null }) {
  const [info, setInfo] = useState<{ asset: string, aToken: string, releaseTime: number } | null>(null)
  const [amount, setAmount] = useState<string>('')
  const [balance, setBalance] = useState<string>('0')

  const [decimals, setDecimals] = useState<number>(18)

  useEffect(() => {
    if (!provider) return
    const vault = new Contract(vaultAddress, VAULT_ABI, provider)
    ;(async () => {
      const asset: string = await vault.asset()
      const aToken: string = await vault.aToken()
      const releaseTime: bigint = await vault.releaseTime()
      const dec = await new Contract(asset, ["function decimals() view returns (uint8)"], provider).decimals()
      setDecimals(Number(dec))
      setInfo({ asset, aToken, releaseTime: Number(releaseTime) })
    })()
  }, [provider, vaultAddress])

  async function refreshBalance() {
    if (!provider || !info) return
    const bal: bigint = await new Contract(info.aToken, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(vaultAddress)
    setBalance(formatUnits(bal, decimals))
  }

  useEffect(() => { refreshBalance() }, [info])

  async function approveAndDeposit(e: React.FormEvent) {
    e.preventDefault()
    if (!provider || !info) return
    const signer = await provider.getSigner()
    const amt = parseUnits(amount || '0', decimals)
    if (amt === 0n) return
    const erc20 = new Contract(info.asset, [
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function balanceOf(address owner) view returns (uint256)"
    ], provider)

    const allowance: bigint = await erc20.allowance(await signer.getAddress(), vaultAddress)
    if (allowance < amt) {
      const tx = await (erc20 as any).connect(signer).approve(vaultAddress, amt)
      await tx.wait()
    }

    const vault = new Contract(vaultAddress, VAULT_ABI, provider)
    const tx2 = await (vault as any).connect(signer).deposit(amt)
    await tx2.wait()
    setAmount('')
    await refreshBalance()
  }

  async function withdrawAll() {
    if (!provider || !info) return
    const signer = await provider.getSigner()
    const vault = new Contract(vaultAddress, VAULT_ABI, provider)
    const now = Math.floor(Date.now() / 1000)
    const release: number = info.releaseTime
    if (now < release) {
      alert('Vault is still locked')
      return
    }
    const tx = await (vault as any).connect(signer).withdrawAll(await signer.getAddress())
    await tx.wait()
    await refreshBalance()
  }

  async function sweepATokens() {
    if (!provider || !info) return
    const signer = await provider.getSigner()
    const vault = new Contract(vaultAddress, VAULT_ABI, provider)
    const now = Math.floor(Date.now() / 1000)
    const release: number = info.releaseTime
    if (now < release) {
      alert('Vault is still locked')
      return
    }
    const tx = await (vault as any).connect(signer).sweepATokensAfterRelease(await signer.getAddress())
    await tx.wait()
    await refreshBalance()
  }

  async function withdrawPartial() {
    if (!provider || !info) return
    const signer = await provider.getSigner()
    const vault = new Contract(vaultAddress, VAULT_ABI, provider)
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
        <div>aToken balance (est. withdrawable): {balance}</div>
        {info && (
          <>
            <div>Asset: {info.asset}</div>
            <div>aToken: {info.aToken}</div>
            <div>Release time: {new Date(info.releaseTime * 1000).toLocaleString()}</div>
          </>
        )}
      </div>

      <form onSubmit={approveAndDeposit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
        <button type="submit">Approve + Deposit</button>
      </form>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={withdrawPartial}>Withdraw</button>
        <button onClick={withdrawAll}>Withdraw All</button>
        <button onClick={sweepATokens}>Sweep aTokens</button>
      </div>
    </div>
  )
}
