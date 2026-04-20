import { useLeague } from "../context/LeagueContext";

export function Rules() {
  const { bundle } = useLeague();
  if (!bundle) return null;
  const { teamComposition, scoring } = bundle.rules;

  return (
    <div className="space-y-10 pb-4">
      <section>
        <h2 className="font-display text-2xl tracking-wide text-white">{teamComposition.title}</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
          {teamComposition.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-display text-2xl tracking-wide text-white">{scoring.title}</h2>
        <div className="mt-4 space-y-6">
          {scoring.sections.map((sec) => (
            <div key={sec.heading}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
                {sec.heading}
              </h3>
              <div className="app-table mt-2">
                <table className="w-full min-w-[280px] text-left text-sm">
                  <thead className="app-table-head">
                    <tr>
                      <th className="px-3 py-2 font-medium">Action</th>
                      <th className="px-3 py-2 font-medium">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r) => (
                      <tr key={r.action} className="app-table-row">
                        <td className="px-3 py-2 text-slate-300">{r.action}</td>
                        <td className="px-3 py-2 tabular-nums text-cyan-400">{r.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm leading-relaxed text-slate-400">{scoring.footer}</p>
      </section>
    </div>
  );
}
