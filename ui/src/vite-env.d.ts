/// <reference types="vite/client" />

declare module "virtual:tabler-shards" {
  import type { ComponentType } from "react";
  type TablerShardIcon = ComponentType<{ size?: number | string; stroke?: number | string; color?: string; className?: string }>;
  const shards: Record<string, () => Promise<{ default: Record<string, TablerShardIcon> }>>;
  export default shards;
}
