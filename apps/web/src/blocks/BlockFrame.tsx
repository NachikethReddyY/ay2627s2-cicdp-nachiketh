import { Component, type ReactNode } from "react";

type Props = { describe: string; raw: unknown; children: ReactNode };

/** One per block: a crash shows the block's text summary instead of blanking the lesson. */
export default class BlockFrame extends Component<Props, { failed: boolean; asText: boolean }> {
  state = { failed: false, asText: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="group" className="rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-3 text-sm shadow-[var(--lift-sm)]">
        <p className="break-words font-medium">{this.props.describe}</p>
        <button type="button" className="pill mt-2 min-h-11 px-4 text-sm" aria-expanded={this.state.asText}
          onClick={() => this.setState((s) => ({ asText: !s.asText }))}>
          Show as text
        </button>
        {this.state.asText && <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(this.props.raw, null, 2)}</pre>}
      </div>
    );
  }
}
