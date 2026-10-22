import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const web = text(400).refine((v) => {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}, "Bitte einen vollständigen HTTPS-Link angeben.");
export const memberProfileSchema = z
  .object({
    headline: text(120),
    company: text(120),
    location: text(80),
    services: z.array(text(60).min(2)).max(12),
    industries: z.array(text(60).min(2)).max(12),
    about: text(1000),
    projects: text(1400),
    lookingFor: text(1000),
    availability: z.enum(["offen", "nach_absprache", "ausgelastet"]),
    contactPhone: text(40),
    contactEmail: z.union([
      z.literal(""),
      text(254).email("Bitte prüfe die E-Mail-Adresse."),
    ]),
    website: web,
    references: z
      .array(
        z
          .object({ title: text(100).min(2), description: text(500), url: web })
          .strict(),
      )
      .max(6),
    listed: z.boolean(),
  })
  .strict();
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export const emptyMemberProfile: MemberProfile = {
  headline: "",
  company: "",
  location: "",
  services: [],
  industries: [],
  about: "",
  projects: "",
  lookingFor: "",
  availability: "offen",
  contactPhone: "",
  contactEmail: "",
  website: "",
  references: [],
  listed: false,
};
export type DirectoryMember = MemberProfile & {
  id: string;
  name: string;
  role: string;
  avatarUrl: string;
  mine: boolean;
  levels: { label: string; level: number }[];
  packageName: string;
};
export const AVAILABILITY = {
  offen: "Offen für Zusammenarbeit",
  nach_absprache: "Nach Absprache",
  ausgelastet: "Aktuell ausgelastet",
};
export function searchText(value: string) {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}
function concept(word: string) {
  if (/^(recruit|personalgewinn|mitarbeitergewinn|personalbeschaff)/.test(word))
    return "recruiting";
  if (/^handwerk/.test(word)) return "handwerk";
  if (/^(webdesign|webseite|website)/.test(word)) return "webdesign";
  return word;
}
/** AND across search terms: Recruiting + Handwerk must both match. */
export function matchesMember(
  member: DirectoryMember,
  query: string,
  scope: "angebote" | "gesuche" | "projekte" = "angebote",
) {
  const words = searchText(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(concept);
  const haystack = searchText(
    [
      member.name,
      member.company,
      member.location,
      ...member.industries,
      ...(scope === "gesuche"
        ? [member.lookingFor]
        : scope === "projekte"
          ? [member.projects]
          : [
              member.headline,
              member.role,
              ...member.services,
              member.about,
              ...member.references.flatMap((r) => [r.title, r.description]),
            ]),
    ].join(" "),
  );
  const concepts = haystack
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(concept);
  return words.every(
    (word) => haystack.includes(word) || concepts.includes(word),
  );
}
