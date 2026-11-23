import type { HomeData } from "../../lib/api";

const mark = (answer: boolean | null) => answer === null ? "—" : answer ? "Correct" : "Incorrect";

export default function Learning({ items }: { items: HomeData["learning"] }) {
  if (items.length === 0) return null;
  return (
    <section className="lq-card lq-dashboard-assessments" aria-labelledby="learning-h">
      <div className="lq-sec-head"><h2 id="learning-h">Before and after</h2></div>
      <table className="lq-dashboard-table">
        <thead><tr><th scope="col">Concept</th><th scope="col">Pre-test</th><th scope="col">Post-test</th></tr></thead>
        <tbody>
          {items.map(({ slug, pre, post }) => (
            <tr key={slug}>
              <th scope="row">{slug.replace(/^js\./, "").replaceAll("-", " ")}</th>
              <td data-correct={pre ?? undefined}>{mark(pre)}</td>
              <td data-correct={post ?? undefined}>{mark(post)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
