import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { HeroSignalCard } from './components/HeroSignalCard';
import { TradingChart } from './components/TradingChart';
import { BacktestStatsPanel } from './components/BacktestStatsPanel';
import { SignalLogTable } from './components/SignalLogTable';
import { ControlDrawer } from './components/ControlDrawer';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  fetchLiveTicker,
  fetchMarketCandles,
  subscribeBinanceKline,
  subscribeBinanceTicker,
} from './lib/marketData';
import { evaluateSignals } from './lib/pineEngine';
import { playSignalChime, requestNotificationPermission, sendLocalNotification } from './lib/notifications';
import {
  appendStoredSignal,
  getStoredConfig,
  getStoredSignals,
  saveStoredConfig,
  saveStoredSignals,
} from './lib/storage';
import { BacktestSummary, LiveTicker, MarketCandle, SignalRecord, StrategyConfig } from './types/signal';
import { Activity, ShieldCheck } from 'lucide-react';

export default function App() {
  const [config, setConfig] = useState<StrategyConfig>(getStoredConfig);
  const [ticker, setTicker] = useState<LiveTicker>({
    symbol: 'BTC/USD',
    price: 0,
    change24h: 0,
    high24h: 0,
    low24h: 0,
    volume24h: 0,
    timestamp: Date.now(),
    source: 'Connecting…',
  });
  const [candles, setCandles] = useState<MarketCandle[]>([]);
  const [marketSource, setMarketSource] = useState<string>('Initializing…');
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'error' | 'closed'>('connecting');
  const [activeSignal, setActiveSignal] = useState<SignalRecord | null>(null);
  const [signalsHistory, setSignalsHistory] = useState<SignalRecord[]>(getStoredSignals);
  const [backtestStats, setBacktestStats] = useState<BacktestSummary>({
    totalTrades: 0,
    buys: 0,
    sells: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    profitFactor: 0,
    netR: 0,
    avgR: 0,
    tp1Hits: 0,
    tp2Hits: 0,
    maxConsecutiveLosses: 0,
    verdict: 'CALCULATING',
  });
  const [indicators, setIndicators] = useState<any>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [lastApiSignalId, setLastApiSignalId] = useState<string | null>(null);

  const prevSignalIdRef = useRef<string | null>(null);
  const candlesRef = useRef<MarketCandle[]>([]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  const applyEval = useCallback(
    (newCandles: MarketCandle[]) => {
      const evalResult = evaluateSignals(newCandles, config);
      setActiveSignal(evalResult.activeSignal);
      setBacktestStats(evalResult.backtest);
      setIndicators(evalResult.latestIndicators);

      if (evalResult.history.length > 0) {
        setSignalsHistory((prev) => {
          const merged = [...prev];
          for (const s of evalResult.history) {
            if (!merged.some((m) => m.id === s.id)) merged.push(s);
          }
          merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          saveStoredSignals(merged);
          return merged;
        });
      }

      if (
        evalResult.activeSignal &&
        evalResult.activeSignal.action !== 'HOLD' &&
        prevSignalIdRef.current &&
        prevSignalIdRef.current !== evalResult.activeSignal.id
      ) {
        if (config.soundAlerts && (evalResult.activeSignal.action === 'BUY' || evalResult.activeSignal.action === 'SELL')) {
          playSignalChime(evalResult.activeSignal.action);
        }
        if (config.pushNotifications) {
          sendLocalNotification(
            `BTC/USD ${evalResult.activeSignal.action} Signal`,
            `Entry: $${evalResult.activeSignal.price} | TP2: $${evalResult.activeSignal.tp2} | SL: $${evalResult.activeSignal.sl}`
          );
        }
      }
      if (evalResult.activeSignal) prevSignalIdRef.current = evalResult.activeSignal.id;
    },
    [config]
  );

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { candles: newCandles, source } = await fetchMarketCandles(config.timeframe, config.twelveDataApiKey);
      setCandles(newCandles);
      setMarketSource(source);
      const newTicker = await fetchLiveTicker(config.twelveDataApiKey);
      if (newTicker.price > 0) setTicker(newTicker);
      applyEval(newCandles);
    } catch (err) {
      console.error('Failed to load market telemetry', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [config, applyEval]);

  useEffect(() => {
    loadData();
    if (config.pushNotifications) requestNotificationPermission();
  }, [loadData, config.pushNotifications]);

  useEffect(() => {
    return subscribeBinanceTicker((t) => setTicker(t), (s) => setStreamStatus(s));
  }, []);

  useEffect(() => {
    return subscribeBinanceKline(config.timeframe, (candle, isFinal) => {
      setCandles((prev) => {
        if (!prev.length) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.time === candle.time) next[next.length - 1] = candle;
        else if (!last || candle.time > last.time) {
          next.push(candle);
          if (next.length > 200) next.shift();
        }
        return next;
      });
      if (isFinal) {
        const updated = [...candlesRef.current];
        const li = updated.length - 1;
        if (li >= 0 && updated[li].time === candle.time) updated[li] = candle;
        else updated.push(candle);
        applyEval(updated);
      }
    });
  }, [config.timeframe, applyEval]);

  useEffect(() => {
    const intervalMs = Math.max(30, config.autoRefreshInterval || 60) * 1000;
    const interval = setInterval(() => loadData(), intervalMs);
    return () => clearInterval(interval);
  }, [loadData, config.autoRefreshInterval]);

  const checkApiSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/signal');
      if (res.ok) {
        const data = await res.json();
        if (data?.latest && data.latest.id !== lastApiSignalId) {
          const pushedSignal: SignalRecord = { ...data.latest, source: 'python_script' };
          setLastApiSignalId(pushedSignal.id);
          setActiveSignal(pushedSignal);
          setSignalsHistory(appendStoredSignal(pushedSignal));
          if (config.soundAlerts && (pushedSignal.action === 'BUY' || pushedSignal.action === 'SELL')) {
            playSignalChime(pushedSignal.action);
          }
        }
      }
    } catch {
      /* optional */
    }
  }, [lastApiSignalId, config]);

  useEffect(() => {
    const t = setInterval(checkApiSignals, 15_000);
    return () => clearInterval(t);
  }, [checkApiSignals]);

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] text-[var(--label)] flex flex-col selection:bg-[var(--accent)]/25">
      <Header
        ticker={ticker}
        isOnline={typeof navigator !== 'undefined' ? navigator.onLine : true}
        isRefreshing={isRefreshing}
        streamStatus={streamStatus}
        onRefresh={loadData}
        onOpenSettings={() => setIsDrawerOpen(true)}
        hasTwelveDataKey={!!config.twelveDataApiKey}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-5 py-5 space-y-4 safe-bottom">
        <div className="group-card px-4 py-3 text-xs text-[var(--secondary)] flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-[var(--label)] font-semibold tracking-tight">
            <ShieldCheck className="w-4 h-4 text-[var(--positive)]" />
            Leo 2:1 · Supertrend / MACD / EMA
          </span>
          <span className="text-[var(--tertiary)]">·</span>
          <span className="font-mono tabular-nums text-[var(--tertiary)]">
            {streamStatus === 'live' ? 'WS live' : streamStatus}
          </span>
          <span className="text-[var(--tertiary)]">·</span>
          <span className="font-mono text-[var(--tertiary)] truncate">{marketSource}</span>
        </div>

        {activeSignal ? (
          <HeroSignalCard signal={activeSignal} currentPrice={ticker.price} />
        ) : (
          <div className="group-card p-8 text-center">
            <Activity className="w-7 h-7 mx-auto text-[var(--accent)] mb-2 opacity-80" />
            <div className="text-[15px] font-semibold tracking-tight">Reading market structure</div>
            <div className="text-xs text-[var(--secondary)] mt-1">Waiting for Supertrend confluence…</div>
          </div>
        )}

        <TradingChart
          candles={candles}
          activeSignal={activeSignal}
          timeframe={config.timeframe}
          onTimeframeChange={(tf) => {
            const updated = { ...config, timeframe: tf };
            setConfig(updated);
            saveStoredConfig(updated);
          }}
          source={streamStatus === 'live' ? `${marketSource} · live WS` : marketSource}
        />

        <BacktestStatsPanel stats={backtestStats} indicators={indicators} />
        <SignalLogTable signals={signalsHistory} onClearHistory={() => { setSignalsHistory([]); saveStoredSignals([]); }} />
      </main>

      <ControlDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        config={config}
        onSaveConfig={(c) => { setConfig(c); saveStoredConfig(c); }}
        onTestPushSignal={async () => {
          setIsTestingPush(true);
          try {
            const testPrice = ticker.price || 0;
            await fetch('/api/signal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol: 'BTCUSD',
                action: 'BUY',
                price: testPrice,
                tp1: Math.round((testPrice + 1200) * 100) / 100,
                tp2: Math.round((testPrice + 2400) * 100) / 100,
                sl: Math.round((testPrice - 800) * 100) / 100,
                confidence: 91,
                timestamp: new Date().toISOString(),
              }),
            });
          } finally {
            setIsTestingPush(false);
          }
        }}
        isTestingPush={isTestingPush}
        onRefreshData={loadData}
      />

      <OfflineIndicator />

      <footer className="border-t border-[var(--border-subtle)] py-4 text-center text-[11px] text-[var(--tertiary)] safe-bottom">
        <div className="max-w-3xl mx-auto px-4">SingleTrader · BTC/USD · Free Binance WebSocket</div>
      </footer>
    </div>
  );
}
