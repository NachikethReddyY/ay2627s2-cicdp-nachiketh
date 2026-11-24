function Bar({ width = "100%", height = 12 }: { width?: string | number; height?: number }) {
  return <span className="lq-skeleton-bar" style={{ inlineSize: width, blockSize: height }} />;
}

const week = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function DashboardSkeleton() {
  return (
    <div>
      <p role="status" className="sr">Loading your dashboard…</p>
      <div className="lq-dashboard-flow lq-dashboard-skeleton" aria-hidden="true">
        <div className="lq-dashboard-pair">
          <div className="lq-card lq-hero lq-hero-solo">
            <div className="grid gap-3">
              <Bar width={54} height={9} />
              <Bar width="42%" />
              <Bar width="82%" height={28} />
              <Bar width="55%" />
              <Bar width="68%" />
              <div className="mt-1">
                <Bar width="66%" height={8} />
              </div>
              <Bar width={128} height={44} />
            </div>
          </div>
          <div className="lq-card lq-dashboard-progress">
            <Bar width="52%" height={18} />
            <div className="lq-dashboard-stats">
              <div className="grid gap-2"><Bar width="62%" /><Bar width="46%" height={24} /></div>
              <div className="grid gap-2"><Bar width="55%" /><Bar width="65%" height={24} /></div>
            </div>
            <div className="lq-days">
              {week.map((day) => <div key={day} className="lq-day"><span className="lq-skeleton-bar lq-dot" /><Bar width={8} height={8} /></div>)}
            </div>
            <div className="lq-dashboard-progress-line"><Bar width="28%" /><Bar width="22%" /></div>
            <Bar height={8} />
            <div className="lq-dashboard-progress-line"><Bar width="33%" /><Bar width="25%" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
