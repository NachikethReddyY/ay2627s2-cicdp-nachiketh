import type { HomeData } from "../../lib/api";

const mark = (answer: boolean | null) => answer === null ? "—" : answer ? "Correct" : "Incorrect";

export default function Learning({ items }: { items: HomeData["learning"] }) {
  if (items.length === 0) return null;
  return (
    <section className="lq-card lq-mastery" aria-labelledby="learning-h">
      <div className="lq-sec-head"><h2 id="learning-h">Before and after</h2></div>
      <table className="w-full text-left text-sm">
        <thead><tr><th scope="col">Concept</th><th scope="col">Pre-test</th><th scope="col">Post-test</th></tr></thead>
        <tbody>
          {items.map(({ slug, pre, post }) => (
            <tr key={slug}>
              <th scope="row">{slug.replace(/^js\./, "").replaceAll("-", " ")}</th>
              <td>{mark(pre)}</td><td>{mark(post)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
