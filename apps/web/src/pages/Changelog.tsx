import Markdown from "react-markdown";
import { Disclosure } from "../components/Disclosure";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";
import { releases } from "./changelog-releases.generated";
import { FEEDBACK_URL, REPO_URL } from "./feedback";
import "./changelog.css";

const RELEASES_URL = `${REPO_URL}/releases`;

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

export default function Changelog() {
  return (
    <div className="lp cl">
      <header className="cl-head">
        <div className="cl-head-in">
          <a href="/" className="cl-logo" aria-label="LearnSlop home">
            <svg className="cl-mark" viewBox="0 0 45 45" aria-hidden>
              <path d="M9.4 10.8s3.7 4.8 13.8 7.7c0 0 7.5 2.1 11 6.2 0 0 3.5 2.7 4.8 12.2 0 0-2.9-5.6-11.3-7.8 0 0-8.8-2.2-11.1-3.5s-4.9-3.6-5.9-6.8-1.5-6.9-1.3-8z" fill="#039ff4" />
              <path d="M5.1 23s4.1 3.4 9.1 5.2c0 0 4.1 1.8 10 2.7 0 0 5.4 1.1 8.3 2.8 0 0 5 2.9 7.5 10.3 0 0-2.5-3.3-7-4.1 0 0-2.6-1-10.3-1.3 0 0-5.6.1-10.7-3.1 0 0-3.7-2.1-5.8-8.6-.3 0-1-2.1-1.1-3.9z" fill="#028df1" />
              <path d="M19.2.9s2.6 4 7.2 6.4c0 0 4.3 2.4 6.7 5 0 0 2.2 2 3.7 6.2 0 0 .9 2.3 1.2 7.3 0 0-2-3.6-3.8-4.8 0 0-2-1.6-4.5-2.9S25 15.8 23.1 14s-3.3-3.9-3.7-6.2-.4-5.3-.2-6.9z" fill="#4fbcf7" />
            </svg>
            <span>LearnSlop</span>
          </a>
          <Breadcrumb className="cl-crumbs">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Release notes</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <main className="cl-wrap">
        <h1 className="cl-h1">Release notes</h1>
        <p className="cl-lead">
          Each LearnSlop release, newest first. Open one to see what changed. <a href={RELEASES_URL}>All releases on GitHub</a>
          {" · "}<a href={FEEDBACK_URL}>Report a problem</a>
        </p>
        <ol className="cl-list">
          {releases.map((release) => (
            <li key={release.tag} className="cl-item">
              <div className="cl-meta">
                <time dateTime={release.date} className="cl-date">{formatDate(release.date)}</time>
                <a className="cl-id" href={release.url}>
                  {release.tag}
                  <span className="cl-vh"> release notes, opens on GitHub</span>
                </a>
              </div>
              <div className="cl-main">
                <span className="cl-dot" aria-hidden />
                <h3 className="cl-title">{release.title}</h3>
                <div className="cl-sum"><Markdown>{release.summary}</Markdown></div>
                {release.changes.length > 0 && (
                  <Disclosure label="What changed">
                    <ul>
                      {release.changes.map((change) => (
                        <li key={change}><Markdown>{change}</Markdown></li>
                      ))}
                    </ul>
                  </Disclosure>
                )}
              </div>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
