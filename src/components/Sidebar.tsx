import React, { useState } from "react";
import {
  Home,
  Scissors,
  Star,
  Palette,
  CalendarClock,
  Bot,
  ChevronDown,
  Building2,
  LogOut,
  Cloud,
  X,
} from "lucide-react";
import { User } from "firebase/auth";
import { AppRoute } from "../types";

interface SidebarProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  totalClipsCount: number;
  favoritesCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  authUser: User | null;
  authLoading: boolean;
  isAdmin: boolean;
  onSignInGoogle: () => void;
  onSignOut: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeRoute,
  onNavigate,
  totalClipsCount,
  favoritesCount,
  mobileOpen,
  onCloseMobile,
  authUser,
  authLoading,
  isAdmin,
  onSignInGoogle,
  onSignOut,
}) => {
  const defaultWsName = authUser?.displayName
    ? `${authUser.displayName.split(" ")[0]}'s Workspace`
    : "Creator Workspace";
  const [customWsName, setCustomWsName] = useState<string | null>(null);
  const [wsOpen, setWsOpen] = useState(false);

  const workspaceName = customWsName || defaultWsName;
  const workspaces = [defaultWsName, "Podcast Studio", "Client Reels Team"];

  const navItemClass = (isActive: boolean) =>
    `w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
      isActive
        ? "bg-[#181B24] text-white border border-blue-500/40"
        : "text-zinc-400 hover:text-zinc-100 hover:bg-[#17171C] border border-transparent"
    }`;

  const content = (
    <aside className="w-[248px] h-full bg-[#0E0E11] border-r border-[#222229] flex flex-col justify-between shrink-0 select-none">
      <div className="p-3.5 space-y-5 overflow-y-auto">
        {/* Workspace Switcher */}
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setWsOpen((o) => !o)}
              className="flex-1 flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-[#17171C] transition-colors text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-white truncate">{workspaceName}</p>
                  <p className="text-[11px] text-zinc-500">
                    {authUser ? (isAdmin ? "Admin · Cloud Sync" : "Cloud Synced") : "AI Video Clip Generator"}
                  </p>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />
            </button>
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 text-zinc-400 hover:text-white"
              aria-label="Close navigation menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {wsOpen && (
            <div className="absolute left-0 right-0 mt-1.5 z-30 bg-[#16161B] border border-[#2A2A33] rounded-lg p-1 shadow-xl">
              {workspaces.map((ws) => (
                <button
                  key={ws}
                  type="button"
                  onClick={() => {
                    setCustomWsName(ws === defaultWsName ? null : ws);
                    setWsOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors ${
                    ws === workspaceName
                      ? "bg-blue-600/20 text-blue-300 font-medium"
                      : "text-zinc-300 hover:bg-white/5"
                  }`}
                >
                  {ws}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Primary Home */}
        <div>
          <button
            type="button"
            onClick={() => {
              onNavigate("home");
              onCloseMobile();
            }}
            className={navItemClass(activeRoute === "home" || activeRoute === "configure" || activeRoute === "clips")}
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              <Home className="w-4 h-4 text-zinc-400" />
              Home
            </span>
          </button>
        </div>

        {/* Library */}
        <div className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-medium text-zinc-500">Library</p>
          <button
            type="button"
            onClick={() => {
              onNavigate("all-clips");
              onCloseMobile();
            }}
            className={navItemClass(activeRoute === "all-clips")}
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              <Scissors className="w-4 h-4 text-zinc-400" />
              All Clips
            </span>
            <span className="text-xs font-mono tabular-nums text-zinc-500">{totalClipsCount}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate("favorites");
              onCloseMobile();
            }}
            className={navItemClass(activeRoute === "favorites")}
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              <Star className="w-4 h-4 text-zinc-400" />
              Favorites
            </span>
            <span className="text-xs font-mono tabular-nums text-zinc-500">{favoritesCount}</span>
          </button>
        </div>

        {/* Tools */}
        <div className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-medium text-zinc-500">Tools</p>
          <button
            type="button"
            onClick={() => {
              onNavigate("brand-templates");
              onCloseMobile();
            }}
            className={navItemClass(activeRoute === "brand-templates")}
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              <Palette className="w-4 h-4 text-zinc-400" />
              Brand Templates
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate("social-scheduler");
              onCloseMobile();
            }}
            className={navItemClass(activeRoute === "social-scheduler")}
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              <CalendarClock className="w-4 h-4 text-zinc-400" />
              Social Scheduler
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onNavigate("ai-assistant");
              onCloseMobile();
            }}
            className={navItemClass(activeRoute === "ai-assistant")}
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              <Bot className="w-4 h-4 text-zinc-400" />
              AI Clip Assistant
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Auth & Cloud Sync Card */}
      <div className="p-3.5 border-t border-[#222229] space-y-2.5">
        {/* Public User Auth & Cloud Sync Card */}
        {authUser ? (
          <div className="p-2.5 rounded-lg bg-[#141419] border border-[#24242D] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {authUser.photoURL ? (
                <img
                  src={authUser.photoURL}
                  alt={authUser.displayName || "User"}
                  className="w-7 h-7 rounded-full object-cover shrink-0 border border-[#2D2D38]"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-xs font-bold text-blue-300 shrink-0">
                  {(authUser.displayName || authUser.email || "U")[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">
                  {authUser.displayName || "Creator"}
                </p>
                <p className="text-[10px] text-emerald-400 flex items-center gap-1 truncate">
                  <Cloud className="w-2.5 h-2.5 shrink-0" />
                  Synced
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-[#1F1F28] transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={authLoading}
            onClick={onSignInGoogle}
            className="w-full py-2 px-3 rounded-lg bg-white hover:bg-zinc-100 disabled:opacity-60 text-zinc-900 text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>{authLoading ? "Connecting..." : "Sign in with Google"}</span>
          </button>
        )}

        <p className="text-[10px] text-zinc-500 text-center pt-1 font-mono">
          AI Video Clip Generator · Dev: HBM
        </p>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
};
