import { useAtomValue } from "@effect/atom-react";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  type LimitPool,
} from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import type { RuntimeMode } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { ChartNoAxesColumnIcon, SettingsIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  updateClientSettings,
  usePrimarySettings,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";
import { readAppearanceModePreference, useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { useIssuesSupported, usePullRequestsSupported } from "~/state/environments";
import { environmentPresentations } from "~/state/presentation";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { readIssueListPreferences } from "../issue/issueListPreferences";
import { IssueGlyph } from "../issue/issuePresentation";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { SidebarUpdatePill } from "../sidebar/SidebarUpdatePill";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const CHIP =
  "inline-flex h-7.5 shrink-0 items-center gap-2 rounded-full border border-(--oh-card-border) bg-(--oh-card) px-3 text-xs whitespace-nowrap text-foreground/85";

/** One provider's tightest limits: what is left in each window and when it refills. */
function LimitChip(props: { readonly pool: LimitPool; readonly now: number }) {
  const gt = useGT();
  const m = useMessages();
  const label = providerClients.get(props.pool.driver)?.label ?? String(props.pool.driver);
  // The two windows closest to running out say the most in the least room.
  const windows = displayLimitWindows(props.pool)
    .toSorted((a, b) => a.remainingPercent - b.remainingPercent)
    .slice(0, 2);
  return (
    <Link
      to="/usage"
      data-orchestrator-limit={props.pool.driver}
      className={cn(
        CHIP,
        "outline-none hover:bg-(--oh-sub-hover) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <ProviderInstanceIcon
        driverKind={props.pool.driver}
        displayName={label}
        indicatorBackground="transparent"
        className="size-4"
        iconClassName="size-3.5 text-foreground/80"
      />
      <span className="font-medium">{label}</span>
      {windows.map((window) => {
        const reset = window.members[0]
          ? formatResetsIn(window.members[0].window, props.now, m, "refill")
          : null;
        return (
          <span key={`${window.kind}:${window.id}`} className="text-muted-foreground">
            {gt("{window} {percent}% left", {
              window: window.label,
              percent: Math.round(window.remainingPercent),
              $context: "share of a usage limit still available in a time window",
            })}
            {reset === null ? null : <span className="ms-1 opacity-75">{reset}</span>}
          </span>
        );
      })}
    </Link>
  );
}

function CountChip(props: {
  readonly value: number;
  readonly label: string;
  readonly tone: string;
}) {
  return (
    <span className={CHIP}>
      <span className={cn("font-semibold tabular-nums", props.tone)}>{props.value}</span>
      <span className="text-muted-foreground">{props.label}</span>
    </span>
  );
}

/** The settings worth reaching from the home, without leaving it. */
function QuickSettings() {
  const gt = useGT();
  const m = useMessages();
  const { theme, setAppearanceMode } = useTheme();
  const runtimeMode = usePrimarySettings((settings) => settings.defaultRuntimeMode);
  const updatePrimarySettings = useUpdatePrimarySettings();
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-sm-pill" variant="outline" aria-label={gt("Quick settings")} />}
      >
        <SlidersHorizontalIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>
            <T>Appearance</T>
          </MenuGroupLabel>
          <MenuRadioGroup
            value={readAppearanceModePreference(theme)}
            onValueChange={(value) => {
              if (value === "light" || value === "dark" || value === "system") {
                setAppearanceMode(value);
              }
            }}
          >
            <MenuRadioItem value="light">{gt("Light", { $context: "colour theme" })}</MenuRadioItem>
            <MenuRadioItem value="dark">{gt("Dark", { $context: "colour theme" })}</MenuRadioItem>
            <MenuRadioItem value="system">
              {gt("Match system", { $context: "colour theme follows the operating system" })}
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>
            <T>Permissions for new threads</T>
          </MenuGroupLabel>
          <MenuRadioGroup
            value={runtimeMode}
            onValueChange={(value) =>
              updatePrimarySettings({ defaultRuntimeMode: value as RuntimeMode })
            }
          >
            {runtimeModeOptions.map((mode) => (
              <MenuRadioItem key={mode} value={mode}>
                {m(runtimeModeConfig[mode].label)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem render={<Link to="/usage" />}>
          <T>Usage and limits</T>
        </MenuItem>
        <MenuItem render={<Link to="/settings/providers" />}>
          <T>Models and providers</T>
        </MenuItem>
        <MenuItem render={<Link to="/settings" />}>
          <T>All settings</T>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => void updateClientSettings({ orchestratorHomeEnabled: false })}>
          <T>Turn off Orchestrator home</T>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function UtilityButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm-pill"
            variant="outline"
            aria-label={props.label}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** The sidebar footer's buttons, which the home would otherwise hide along with the sidebar. */
function UtilityButtons() {
  const gt = useGT();
  const navigate = useNavigate();
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  return (
    <>
      <UtilityButton label={gt("Settings")} onClick={() => void navigate({ to: "/settings" })}>
        <SettingsIcon />
      </UtilityButton>
      {pullRequestsSupported ? (
        <UtilityButton
          label={gt("Pull requests")}
          onClick={() =>
            void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() })
          }
        >
          <PullRequestGlyph.pullRequest />
        </UtilityButton>
      ) : null}
      {issuesSupported ? (
        <UtilityButton
          label={gt("Issues", { $context: "sidebar link to the list of issues" })}
          onClick={() => void navigate({ to: "/issues", search: readIssueListPreferences() })}
        >
          <IssueGlyph.issue />
        </UtilityButton>
      ) : null}
      <UtilityButton label={gt("Usage")} onClick={() => void navigate({ to: "/usage" })}>
        <ChartNoAxesColumnIcon />
      </UtilityButton>
      {/* The update button is a list item, as it is in the sidebar. */}
      <ul className="flex items-center">
        <SidebarUpdatePill />
      </ul>
    </>
  );
}

/** One row above the panels: provider limits, live counts, and the home's own controls. */
export function OrchestratorTopBar(props: {
  readonly now: number;
  readonly running: number;
  readonly needsYou: number;
  readonly readyToShip: number;
  /** The Panels control; it lives here but belongs to the layout. */
  readonly panels: ReactNode;
}) {
  const gt = useGT();
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const pools = collectLimitPools(collectLimitAccounts(presentations), props.now);
  return (
    <header
      className="drag-region flex shrink-0 items-center gap-2"
      // Clears the macOS window buttons, which sit over the start of this row in the desktop app.
      style={{ paddingInlineStart: "max(0px, calc(var(--workspace-controls-left) - 2rem))" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden [-webkit-app-region:no-drag]">
        {pools.length === 0 ? (
          <Link to="/usage" className={cn(CHIP, "text-muted-foreground")}>
            <T>No provider reports usage limits</T>
          </Link>
        ) : (
          pools.map((pool) => <LimitChip key={pool.driver} pool={pool} now={props.now} />)
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
        <CountChip
          value={props.running}
          label={gt("running", { $context: "count of agent threads working now" })}
          tone="text-blue-600 dark:text-blue-400"
        />
        <CountChip
          value={props.needsYou}
          label={gt("need you", { $context: "count of threads waiting on the user" })}
          tone="text-amber-600 dark:text-amber-400"
        />
        <CountChip
          value={props.readyToShip}
          label={gt("ready to ship", { $context: "count of pull requests ready to merge" })}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        {props.panels}
        <QuickSettings />
        <UtilityButtons />
      </div>
    </header>
  );
}
