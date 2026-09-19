import { Redirect } from 'expo-router';

/** Legacy starter route: keep old links safe after Markets became a primary tab. */
export default function ExploreRedirect() {
  return <Redirect href="/markets" />;
}
