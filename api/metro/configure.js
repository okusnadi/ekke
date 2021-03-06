const { mergeConfig, loadConfig } = require('metro-config');
const resolve = require('metro-resolver').resolve;
const diagnostics = require('diagnostics');
const source = require('./source');
const path = require('path');

//
// Debug logger.
//
const debug = diagnostics('ekke:configure');

/**
 * Generate the contents of the metro.config that should be used to build
 * the tests.
 *
 * @param {Object} flags The configuration flags of the API/CLI.
 * @returns {Promise<Object>} configuration.
 * @public
 */
async function configure(flags) {
  const reactNativePath = path.dirname(require.resolve('react-native/package.json'));
  const config = await loadConfig();
  const custom = {
    resolver: {},
    serializer: {},
    transformer: {}
  };

  //
  // We need to create a fake package name that we will point to the root
  // of the users directory so we can resolve their requires and test files
  // without having to rely on `package.json` based resolve due to poor
  // handling of absolute and relative paths.
  //
  // See: https://github.com/facebook/react-native/issues/3099
  //
  const fake = 'ekke-ekke-ekke-ekke';

  //
  // Check if we're asked to nuke the cache, we should. This option will
  // be your next best friend.
  //
  custom.resetCache = !!flags['reset-cache'];

  //
  // Prevent the Metro bundler from outputting to the console by using a
  // custom logger that redirects all output to our debug utility. We want
  // to minimize the output so the test responses can be piped to other
  // processes in the case of tap based test runners.
  //
  if (flags.silent) custom.reporter = {
    update: function log(data) {
      debug('status:', data);
    }
  };

  //
  // We want to polyfill the `util`, `http` and other standard Node.js
  // libraries so any Node.js based code has at least a chance to get
  // bundled without throwing any errors. The `extraNodeModules` option
  // gets us there, but it doesn't work for all transforms we need to
  // make, so we need to go deeper, and solve it as an AST level using
  // babel and that requires our own custom transformer.
  //
  custom.transformer.babelTransformerPath = path.join(__dirname, 'babel.js');

  custom.resolver.extraNodeModules = {
    [fake]: process.cwd()
  };

  //
  // Mother of all hacks, we don't have a single entry point, we have multiple
  // as our test files are represented in a glob, that can point to an infinite
  // number of modules.
  //
  // Unfortunately, there isn't an API or config method available in Metro
  // that will allow us to inject files that need to be included AND resolve
  // those files dependencies. The only thing that comes close is the
  // `serializer.polyfillModuleNames` which will include those files, but
  // not their dependencies.
  //
  // That leaves us with this horrible alternative, creating a tmp.js file
  // with absolute paths to the files we want to import. So we're going to
  // intercept the `package.json` bundle operation and return the location of
  // our temp file so that will be required instead of the actual contents of
  // the `package.json` file. But then I realized, we can just put anything
  // we want in the URL, and it would end up here. So let's go with something
  // that fit our theme.
  //
  const filePath = await source({
    globs: [].concat(flags.require).concat(flags.argv),
    runner: flags.using,
    fake
  });

  custom.resolver.resolveRequest = function resolveRequest(context, file, platform) {
    if (file === './Ekke-Ekke-Ekke-Ekke-PTANG.Zoo-Boing.Znourrwringmm') return {
      type: 'sourceFile',
      filePath
    };

    //
    // We only wanted to abuse the `resolveRequest` method to intercept a
    // give request and point it to a completely different, unknown file. The
    // last thing we've wanted to do the actual resolving, so we're going to
    // rely on the `metro-resolver` module for that..
    //
    // Unfortunately, there's an issue, as we've set a `resolveRequest`
    // function the resolver function thinks it needs to use that resolver to
    // resolve the file, leading to an infinite loop, pain, suffering. So
    // before we can continue, we need to check if we should remove our
    // self from the context so the resolver works as intended again.
    //
    if (context.resolveRequest === resolveRequest) {
      context.resolveRequest = null;
    }

    debug(`resovling file(${file})`);
    return resolve(context, file, platform);
  };

  //
  // It's important to understand that while Metro is branded as the JavaScript
  // bundler for React-Native, it's not configured out of the box to support
  // React-Native, all this configuration work is done by the CLI.
  //
  // That's where package resolving, and custom metro.config creation
  // is happening. The following fields are important for this:
  //
  // - Instructs Metro that React-Native uses a non-standard require system.
  // - Tell Metro to use the non-standard hasteImpl map that ships in React-Native
  //   so it can process the @providesModule statements without blowing up on
  //   warnOnce, or missing invariant modules.
  // - Instruct it to also look, and honor the dedicated `react-native`
  //   field in package.json's
  // - And point to the correct AssetRegistry, also hidden in the React-Native
  //   module.
  //
  // The `providesModuleNodeModules` and `hasteImplModulePath` are currently
  // not needed to correctly configure metro for Ekke as we're replacing
  // `react-native` with  polyfill, but if we for some reason turn this off,
  // we don't want to research the undocumented codebase of Metro, cli, and
  // React-Native again to figure out how to correctly resolve and bundle
  // React-Native.
  //
  custom.resolver.providesModuleNodeModules = ['react-native'];
  custom.resolver.hasteImplModulePath = path.join(reactNativePath, 'jest/hasteImpl');
  custom.resolver.resolverMainFields = ['react-native', 'browser', 'main'];
  custom.transformer.assetRegistryPath = path.join(reactNativePath, 'Libraries/Image/AssetRegistry');

  const merged = mergeConfig(config, custom);
  debug('metro config', merged);

  return merged;
}

module.exports = configure;
