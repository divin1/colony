import ProjectSettingsPage from "./ProjectSettingsPage";

export async function generateStaticParams() {
  return [{ id: "__placeholder" }];
}

export default function Page() {
  return <ProjectSettingsPage />;
}
