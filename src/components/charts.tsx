"use client";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";

const axis = { stroke: "transparent", tickLine: false as const };
const grid = <CartesianGrid stroke="#222226" vertical={false} />;
const tip = {
  contentStyle: { background: "#1c1c1f", border: "1px solid #2a2a2f", borderRadius: 12, fontSize: 12, color: "#f2f2f4" },
  labelStyle: { color: "#a1a1aa" }, cursor: { fill: "rgba(255,255,255,.04)", stroke: "#3a3a40" },
};

export type Pt = Record<string, string | number | null>;

export function LineChartBox({ data, x, lines, height = 220, refY, refLabel, domain }: { data: Pt[]; x: string; lines: { key: string; name: string; color?: string }[]; height?: number; refY?: number; refLabel?: string; domain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"] }) {
  return (
    <div style={{ height }} className="-ml-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {grid}
          <XAxis dataKey={x} {...axis} minTickGap={24} />
          <YAxis {...axis} width={40} domain={domain ?? ["auto", "auto"]} />
          <Tooltip {...tip} />
          {refY != null && <ReferenceLine y={refY} stroke="#6b6b74" strokeDasharray="4 4" label={{ value: refLabel, fill: "#6b6b74", fontSize: 11, position: "insideTopRight" }} />}
          {lines.map((l) => <Line key={l.key} dataKey={l.key} name={l.name} type="monotone" stroke={l.color ?? "#b5d86a"} strokeWidth={2.2} dot={{ r: 2.5, strokeWidth: 0, fill: l.color ?? "#b5d86a" }} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChartBox({ data, x, bars, height = 220, refY, refLabel, stacked }: { data: Pt[]; x: string; bars: { key: string; name: string; color?: string }[]; height?: number; refY?: number; refLabel?: string; stacked?: boolean }) {
  return (
    <div style={{ height }} className="-ml-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {grid}
          <XAxis dataKey={x} {...axis} minTickGap={12} />
          <YAxis {...axis} width={40} />
          <Tooltip {...tip} />
          {refY != null && <ReferenceLine y={refY} stroke="#6b6b74" strokeDasharray="4 4" label={{ value: refLabel, fill: "#6b6b74", fontSize: 11, position: "insideTopRight" }} />}
          {bars.map((b) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color ?? "#b5d86a"} radius={[4, 4, 0, 0]} stackId={stacked ? "s" : undefined} maxBarSize={36} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
