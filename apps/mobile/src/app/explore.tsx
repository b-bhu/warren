import { Redirect } from 'expo-router';

/** Legacy starter route: keep deep links safe while the app exposes a single shell. */
export default function ExploreRedirect() {
  return <Redirect href="/" />;
}
