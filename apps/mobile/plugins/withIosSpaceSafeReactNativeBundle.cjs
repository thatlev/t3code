const fs = require("node:fs");

const { IOSConfig, withDangerousMod } = require("expo/config-plugins");

const RESOLVED_SCRIPT =
  "\"$(\\\"$NODE_BINARY\\\" --print \\\"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\\\")\"";
const PROJECT_RELATIVE_SCRIPT =
  '"$PROJECT_ROOT/node_modules/react-native/scripts/react-native-xcode.sh"';

module.exports = function withIosSpaceSafeReactNativeBundle(config) {
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const projectRoot = nextConfig.modRequest.platformProjectRoot;
      const projectPath = IOSConfig.Paths.getPBXProjectPath(projectRoot);
      const project = fs.readFileSync(projectPath, "utf8");

      if (project.includes(PROJECT_RELATIVE_SCRIPT)) {
        return nextConfig;
      }
      if (!project.includes(RESOLVED_SCRIPT)) {
        throw new Error("Unable to make the React Native bundle phase space-safe.");
      }

      fs.writeFileSync(
        projectPath,
        project.replace(RESOLVED_SCRIPT, PROJECT_RELATIVE_SCRIPT),
        "utf8",
      );
      return nextConfig;
    },
  ]);
};
