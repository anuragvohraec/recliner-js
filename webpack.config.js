const path = require('path');

module.exports = {
  entry: {
    // "recliner-sw":'./src/recliner-sw.ts',
    "index":'./src/index.ts'
  },
  //devtool: 'inline-source-map',
  module: {
    rules: [
      {
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js' ],
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  watch: false
};