// The one template the sample is rendered through. It reads the job's data as JSON, so nothing in
// the data is ever Typst source (ADR-0013).
#let data = json("data.json")
#set document(title: "Alloy Works sample: " + data.environment, author: "Alloy Works")
#set text(lang: "en", size: 11pt)
#set page(paper: "a4", margin: 2.5cm)

= Alloy Works

This is a sample document, made by a worker for #data.environment.

Requested at #data.requestedAt.
