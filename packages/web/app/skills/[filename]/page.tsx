import SkillEditorPage from "./SkillEditorPage";

export async function generateStaticParams() {
  return [{ filename: "__placeholder" }];
}

export default function Page() {
  return <SkillEditorPage />;
}
