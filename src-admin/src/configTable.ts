/**
 * snmp adapter - writing a table of the config dialog from a custom component
 */

import type { ConfigGenericProps } from '@iobroker/json-config';

/** the part of a custom component `writeTable` needs - every component of this adapter fits it */
interface TableOwner {
    props: ConfigGenericProps;
    onChange: (attr: string, value: unknown) => Promise<void>;
}

/**
 * writeTable - store a table of the configuration and let the dialog show the new rows
 *
 * A table of the json config reads its value when it is mounted and works on its own copy from
 * then on. Rows which are added from outside - by the setup wizard, by the MIB browser or by a
 * template - would therefore stay invisible until the dialog is opened again. `forceUpdate` calls
 * the handler the table has registered for its attribute and hands it the new data, which is what
 * makes the rows appear.
 *
 * @param pSelf the custom component which writes the table
 * @param pAttr name of the table, `devs` or `oids`
 * @param pRows the new content of the table
 */
export async function writeTable(pSelf: TableOwner, pAttr: string, pRows: unknown[]): Promise<void> {
    await pSelf.onChange(pAttr, pRows);
    pSelf.props.oContext.forceUpdate([pAttr], { ...pSelf.props.data, [pAttr]: pRows });
}
