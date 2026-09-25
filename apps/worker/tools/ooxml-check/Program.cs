// Validates one .docx against the Office 2019 file format with the Open XML SDK's validator, the
// check Word's own schemas answer to. It prints every error as JSON and exits 1 when there are any,
// 0 when there are none; any other exit is a check that did not happen, and says why on stderr.
using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

const int Invalid = 1;
const int NotChecked = 2;

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: ooxml-check <path to a .docx>");
    return NotChecked;
}

WordprocessingDocument document;
try
{
    document = WordprocessingDocument.Open(args[0], false);
}
catch (Exception error) when (
    error is IOException
        or FormatException
        or InvalidDataException
        or OpenXmlPackageException
        or UnauthorizedAccessException)
{
    // A file that is not a package at all (a FileFormatException from System.IO.Packaging, for bytes
    // that are not a zip) has no errors to list: the caller is told it was not checked.
    Console.Error.WriteLine($"{args[0]} could not be opened as a Word document: {error.Message}");
    return NotChecked;
}

using (document)
{
    var errors = new OpenXmlValidator(FileFormatVersions.Office2019)
        .Validate(document)
        .Select(error => new
        {
            description = error.Description,
            part = error.Part?.Uri.ToString(),
            path = error.Path?.XPath,
            type = error.ErrorType.ToString(),
        })
        .ToArray();
    Console.WriteLine(JsonSerializer.Serialize(errors));
    return errors.Length == 0 ? 0 : Invalid;
}
