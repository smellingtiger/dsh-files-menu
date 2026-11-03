/**
 * The Host half of dsh-files-menu: the whole feature lives in the browser
 * bundle (`client.js`), which the Web client loads through this package's
 * `./client` export. The row stays in the loader tree so that bundle is
 * served; nothing is registered on the Host.
 */
export function apply() {}