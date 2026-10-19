// @ts-ignore
import { useMagicState } from "react-magic-state";

const mockUsers = [
  { name: "John Doe", email: "john@example.com", plan: "pro" },
  { name: "Jane Doe", email: "jane@example.com", plan: "free" },
];

export default function Dashboard(props: any) {
  const [tab] = useMagicState("overview");
  return (
    <main>
      <h1>Welcome back</h1>
      <p>Analytics coming soon</p>
      <ul>
        {mockUsers.map((u) => (
          <li key={u.email}>{u.name}</li>
        ))}
      </ul>
      {/* <Chart data={props.data} /> */}
    </main>
  );
}
