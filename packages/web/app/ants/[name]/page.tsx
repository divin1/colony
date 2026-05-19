import AntDetailPage from "./AntDetailPage";

export async function generateStaticParams() {
  return [{ name: "__placeholder" }];
}

export default function Page() {
  return <AntDetailPage />;
}
