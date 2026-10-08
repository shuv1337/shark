import type { LiveActivityProps } from "@hark/contracts";
import {
  createLiveActivity,
  type LiveActivityComponent,
  type LiveActivityLayout,
} from "expo-widgets";
import { ApprovalLiveActivityStyle } from "./live-activities/approval";
import { HeroLiveActivityStyle } from "./live-activities/hero";
import { RingLiveActivityStyle } from "./live-activities/ring";
import { ShellLiveActivityStyle } from "./live-activities/shell";
import { SignalLiveActivityStyle } from "./live-activities/signal";
import { StandardLiveActivityStyle } from "./live-activities/standard";
import { StepsLiveActivityStyle } from "./live-activities/steps";
import { TerminalLiveActivityStyle } from "./live-activities/terminal";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./live-activities/types";
import { VerdictLiveActivityStyle } from "./live-activities/verdict";

function renderLayout(
  props: HarkLiveActivityProps,
  environment: HarkLiveActivityEnvironment,
): LiveActivityLayout {
  const standard = StandardLiveActivityStyle(props, environment);
  const approval = ApprovalLiveActivityStyle(props, environment, standard);
  const style = props.style ?? "standard";

  return style === "approval"
    ? approval
    : style === "shell"
      ? ShellLiveActivityStyle(props, environment, approval)
      : style === "verdict"
        ? VerdictLiveActivityStyle(props, environment, approval)
        : style === "signal"
          ? SignalLiveActivityStyle(props, environment, approval)
          : style === "ring"
            ? RingLiveActivityStyle(props, environment, standard)
            : style === "hero"
              ? HeroLiveActivityStyle(props, environment, standard)
              : style === "terminal"
                ? TerminalLiveActivityStyle(props, environment, standard)
                : style === "steps"
                  ? StepsLiveActivityStyle(props, environment, standard)
                  : standard;
}

// Widget-marked functions become source strings under Metro. Vitest does not
// run that transform, so it uses the callable branch to exercise the same
// style dispatch and node trees directly.
const standardSource = StandardLiveActivityStyle as unknown;
const layout: LiveActivityComponent<HarkLiveActivityProps> =
  typeof standardSource === "string"
    ? (`function(props,environment){
        const renderStandard=${standardSource};
        const renderApproval=${ApprovalLiveActivityStyle as unknown};
        const renderShell=${ShellLiveActivityStyle as unknown};
        const renderVerdict=${VerdictLiveActivityStyle as unknown};
        const renderSignal=${SignalLiveActivityStyle as unknown};
        const renderRing=${RingLiveActivityStyle as unknown};
        const renderHero=${HeroLiveActivityStyle as unknown};
        const renderTerminal=${TerminalLiveActivityStyle as unknown};
        const renderSteps=${StepsLiveActivityStyle as unknown};
        const standard=renderStandard(props,environment);
        const approval=renderApproval(props,environment,standard);
        const style=props.style??"standard";
        return style==="approval"?approval:style==="shell"?renderShell(props,environment,approval):style==="verdict"?renderVerdict(props,environment,approval):style==="signal"?renderSignal(props,environment,approval):style==="ring"?renderRing(props,environment,standard):style==="hero"?renderHero(props,environment,standard):style==="terminal"?renderTerminal(props,environment,standard):style==="steps"?renderSteps(props,environment,standard):standard;
      }` as unknown as LiveActivityComponent<HarkLiveActivityProps>)
    : renderLayout;

export default createLiveActivity<LiveActivityProps>("HarkAgentActivity", layout);
