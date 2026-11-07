import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Download, RefreshCw, Settings, Smartphone, WifiOff } from 'lucide-react';
import { LiveTicker } from '../types/signal';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface HeaderProps {
  ticker: LiveTicker;
  isOnline: boolean;
  isRefreshing: boolean;
  streamStatus?: 'connecting' | 'live' | 'error' | 'closed';
  onRefresh: () => void;
  onOpenSettings: () => void;
  hasTwelveDataKey: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  ticker,
  isOnline,
  isRefreshing,
  streamStatus = 'connecting',
  onRefresh,
  onOpenSettings,
  hasTwelveDataKey,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const isPositive = ticker.change24h >= 0;
  const live = streamStatus === 'live';

  return (
    <header className="sticky top-0 z-40 safe-top border-b border-[var(--border-subtle)] bg-[var(--surface)]/92 backdrop-blur-xl">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-[10px] bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shrink-0">
            <span className="text-[13px] font-bold tracking-tight">
              <span className="text-[var(--accent)]">S</span>
              <span className="text-[var(--label)]">T</span>
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-[var(--label)] leading-tight">SingleTrader</div>
            <div className="text-[11px] text-[var(--tertiary)] font-mono tabular-nums">BTC/USD</div>
          </div>

          <div className="hidden sm:flex items-center gap-2 pl-3 ml-1 border-l border-[var(--border-subtle)] font-mono tabular-nums">
            <span className="text-[17px] font-semibold tracking-tight text-[var(--label)]">
              {ticker.price > 0
                ? `$${ticker.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </span>
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}>
              {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(ticker.change24h).toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`flex items-center gap-1.5 h-9 px-2.5 rounded-[10px] text-[11px] font-mono border ${
              isOnline
                ? 'bg-[var(--bg)] text-[var(--secondary)] border-[var(--border-subtle)]'
                : 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/30'
            }`}
          >
            {isOnline ? (
              <>
                <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-[var(--positive)]' : 'bg-[var(--warning)] animate-pulse'}`} />
                <span className="hidden md:inline">{live ? 'Live' : hasTwelveDataKey ? 'API' : '…'}</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline</span>
              </>
            )}
          </div>

          <button type="button" onClick={onRefresh} disabled={isRefreshing} className="pressable h-9 w-9 inline-flex items-center justify-center rounded-[10px] bg-[var(--bg)] border border-[var(--border-subtle)] text-[var(--secondary)]" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[var(--accent)]' : ''}`} />
          </button>

          {isInstallable && !isInstalled && (
            <button type="button" onClick={install} className="pressable h-9 px-3 inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--accent)] text-[#1c1917] text-xs font-semibold">
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Install</span>
            </button>
          )}

          {isIOS && !isInstalled && (
            <button type="button" onClick={() => setShowIOSModal(true)} className="pressable h-9 px-3 inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--label)]">
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          )}

          <button type="button" onClick={onOpenSettings} className="pressable h-9 w-9 sm:w-auto sm:px-3 inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--label)]">
            <Settings className="w-4 h-4 text-[var(--secondary)]" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </div>

      <div className="sm:hidden px-4 py-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs font-mono tabular-nums bg-[var(--bg)]">
        <span className="text-[15px] font-semibold text-[var(--label)]">
          {ticker.price > 0 ? `$${ticker.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
        </span>
        <span className={isPositive ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>
          {isPositive ? '+' : ''}{ticker.change24h.toFixed(2)}%
        </span>
      </div>

      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-[20px] bg-[var(--surface)] border border-[var(--border)] p-6 shadow-2xl">
            <h3 className="text-[17px] font-semibold tracking-tight mb-2">Add to Home Screen</h3>
            <ol className="text-[13px] text-[var(--secondary)] space-y-2 list-decimal pl-4 leading-relaxed">
              <li>Tap Share in Safari</li>
              <li>Choose Add to Home Screen</li>
              <li>Confirm Add</li>
            </ol>
            <button type="button" onClick={() => setShowIOSModal(false)} className="pressable mt-5 w-full h-11 rounded-[12px] bg-[var(--accent)] text-[#1c1917] text-[15px] font-semibold">
              Done
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
