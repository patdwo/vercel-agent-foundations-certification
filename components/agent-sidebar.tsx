"use client";

import { useState } from "react";
import { AgentChat } from "@/components/agent-chat";
import { createDurableChat, useDurableChat } from "@/components/durable-chat";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import type { ShoppingAgentMessage } from "@/lib/agent";

// Kept in sessionStorage so a page refresh can restore the conversation and
// reattach to the workflow run that is still producing the answer.
const KEYS = {
  messages: "ship-it-shop:agent-messages",
  runId: "ship-it-shop:agent-run-id",
};

export function AgentSidebar() {
  // Owned here (not in AgentChat) so the conversation survives the mobile
  // sheet unmounting its content when closed.
  const [chat] = useState(() =>
    createDurableChat<ShoppingAgentMessage>("/api/chat", KEYS),
  );
  useDurableChat(chat, KEYS);

  return (
    <Sidebar side="right" collapsible="offcanvas">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-sm font-semibold">
          Ship It Shop Agent
        </div>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden p-0">
        <AgentChat chat={chat} />
      </SidebarContent>
    </Sidebar>
  );
}
