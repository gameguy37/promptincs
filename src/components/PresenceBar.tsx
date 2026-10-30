import { memo } from "react";
import type { PresenceMeta } from "@/hooks/useTeleprompterSync";
import { initialsOf } from "@/hooks/useAuth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  peers: PresenceMeta[];
  selfUserId: string | null;
}

function PresenceBarImpl({ peers, selfUserId }: Props) {
  // Dedupe by user_id (presence can have duplicates across tabs).
  const seen = new Set<string>();
  const unique = peers.filter((p) => {
    if (seen.has(p.user_id)) return false;
    seen.add(p.user_id);
    return true;
  });
  if (unique.length === 0) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center -space-x-1.5">
        {unique.slice(0, 6).map((p) => (
          <Tooltip key={p.user_id}>
            <TooltipTrigger asChild>
              <div
                className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold text-white shadow-sm"
                style={{ backgroundColor: p.color, borderColor: "#141414" }}
              >
                {p.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt={p.name}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  initialsOf(p.name)
                )}
                {p.editing_block_id && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[#141414]"
                    style={{ backgroundColor: "#22c55e" }}
                  />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {p.name}
              {p.user_id === selfUserId ? " (you)" : ""} · {p.role}
              {p.editing_block_id ? " · editing" : ""}
            </TooltipContent>
          </Tooltip>
        ))}
        {unique.length > 6 && (
          <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#141414] bg-[#2a2a2a] text-[10px] font-semibold text-[#e5e5e5]">
            +{unique.length - 6}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function BlockEditingChipImpl({ peer }: { peer: PresenceMeta }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex h-4 w-4 items-center justify-center rounded-full border text-[8px] font-semibold text-white"
            style={{ backgroundColor: peer.color, borderColor: peer.color }}
            aria-label={`${peer.name} is editing`}
          >
            {peer.avatar_url ? (
              <img src={peer.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              initialsOf(peer.name)
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {peer.name} is editing
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const PresenceBar = memo(PresenceBarImpl);
export const BlockEditingChip = memo(BlockEditingChipImpl);
