(() => {
  // docs/前端美化/设定-三版探索-20261105/content.mjs
  var content_default = {
    "title": "\u957F\u591C\u5C06\u660E",
    "nodes": [
      {
        "id": "geography",
        "title": "\u5730\u7406\u4E0E\u573A\u6240",
        "parentId": null,
        "isSet": true,
        "kind": "place",
        "tags": [],
        "order": 0
      },
      {
        "id": "factions",
        "title": "\u7EC4\u7EC7\u4E0E\u52BF\u529B",
        "parentId": null,
        "isSet": true,
        "kind": "faction",
        "tags": [],
        "order": 100
      },
      {
        "id": "rules",
        "title": "\u89C4\u5219\u4E0E\u7981\u5FCC",
        "parentId": null,
        "isSet": true,
        "kind": "rule",
        "tags": [],
        "order": 200
      },
      {
        "id": "history",
        "title": "\u5386\u53F2\u4E0E\u7EAA\u5E74",
        "parentId": null,
        "isSet": true,
        "kind": "history",
        "tags": [],
        "order": 300
      },
      {
        "id": "objects",
        "title": "\u7269\u4EF6\u4E0E\u7EBF\u7D22",
        "parentId": null,
        "isSet": true,
        "kind": "object",
        "tags": [],
        "order": 400
      },
      {
        "id": "beliefs",
        "title": "\u6C11\u4FD7\u4E0E\u4FE1\u4EF0",
        "parentId": null,
        "isSet": true,
        "kind": "belief",
        "tags": [],
        "order": 500
      },
      {
        "id": "lighthouse",
        "parentId": "geography",
        "title": "\u96FE\u6E2F\u706F\u5854",
        "kind": "place",
        "tags": [
          "\u5730\u70B9",
          "\u5173\u952E\u573A\u666F"
        ],
        "body": "\u96FE\u6E2F\u6700\u5317\u7AEF\u7684\u767D\u8272\u77F3\u5854\uFF0C\u5EFA\u5728\u9000\u6F6E\u540E\u624D\u9732\u51FA\u7684\u9ED1\u7901\u4E0A\u3002\u6BCF\u5230\u51CC\u6668\u4E09\u70B9\uFF0C\u706F\u5149\u4F1A\u5411\u6CA1\u6709\u822A\u7EBF\u7684\u6D77\u57DF\u8F6C\u8FC7\u4E00\u5708\u3002\n\n\u5B83\u4E0D\u53EA\u4E3A\u5F52\u822A\u8005\u6307\u8DEF\uFF0C\u4E5F\u66FF\u67D0\u4E9B\u4EBA\u5B88\u4F4F\u4E0D\u80FD\u88AB\u770B\u89C1\u7684\u4E1C\u897F\u3002\u9547\u4E0A\u7684\u4EBA\u4E60\u60EF\u5728\u5165\u591C\u524D\u79BB\u5F00\u5824\u5CB8\uFF0C\u6CA1\u6709\u4EBA\u516C\u5F00\u8C08\u8BBA\u90A3\u4E00\u675F\u9006\u7740\u6F6E\u6C50\u7684\u5149\u3002",
        "order": 0
      },
      {
        "id": "harbor",
        "parentId": "geography",
        "title": "\u65E7\u6E2F\u4E0E\u6808\u6865",
        "kind": "place",
        "tags": [
          "\u5730\u70B9",
          "\u96FE\u6E2F"
        ],
        "body": "\u65E7\u6E2F\u5DF2\u7ECF\u505C\u7528\u4E03\u5E74\uFF0C\u4ECD\u6709\u4EBA\u5728\u5348\u591C\u4FEE\u8865\u6808\u6865\u3002\u6765\u6E2F\u7684\u7B2C\u4E00\u73ED\u6E21\u8F6E\uFF0C\u4F1A\u5728\u8FD9\u91CC\u591A\u505C\u7559\u4E09\u5206\u949F\u3002",
        "order": 100
      },
      {
        "id": "market",
        "parentId": "geography",
        "title": "\u6F6E\u6C50\u96C6\u5E02",
        "kind": "place",
        "tags": [
          "\u5730\u70B9",
          "\u751F\u6D3B"
        ],
        "body": "\u53EA\u5728\u5927\u6F6E\u9000\u53BB\u7684\u6E05\u6668\u5F00\u5E02\u3002\u644A\u4E3B\u7528\u6CA1\u6709\u65E5\u671F\u7684\u6F6E\u6C50\u8868\u8BB0\u8D26\uFF0C\u51FA\u552E\u88AB\u6D77\u6C34\u9001\u56DE\u6765\u7684\u65E7\u7269\u3002",
        "order": 200
      },
      {
        "id": "keepers",
        "parentId": "factions",
        "title": "\u5B88\u706F\u4EBA\u534F\u4F1A",
        "kind": "faction",
        "tags": [
          "\u7EC4\u7EC7",
          "\u5B88\u671B"
        ],
        "body": "\u7531\u5386\u4EE3\u5B88\u706F\u4EBA\u7EC4\u6210\u7684\u677E\u6563\u534F\u4F1A\uFF0C\u540D\u518C\u4E0A\u6C38\u8FDC\u53EA\u6709\u4E03\u4E2A\u540D\u5B57\u3002\u534F\u4F1A\u8D1F\u8D23\u7EF4\u62A4\u706F\u5854\uFF0C\u4E5F\u51B3\u5B9A\u54EA\u4E9B\u8239\u53EF\u4EE5\u5728\u591C\u91CC\u9760\u5CB8\u3002",
        "order": 300
      },
      {
        "id": "shipping",
        "parentId": "factions",
        "title": "\u5317\u5CB8\u822A\u8FD0\u5C40",
        "kind": "faction",
        "tags": [
          "\u7EC4\u7EC7",
          "\u8C03\u67E5"
        ],
        "body": "\u638C\u7BA1\u96FE\u6E2F\u7684\u822A\u7EBF\u4E0E\u8FDB\u51FA\u8BB0\u5F55\u3002\u4E09\u5E74\u524D\u98CE\u66B4\u5F53\u591C\u7684\u822A\u6D77\u65E5\u5FD7\uFF0C\u81F3\u4ECA\u5C01\u5B58\u5728\u6CA1\u6709\u7F16\u53F7\u7684\u67DC\u5B50\u91CC\u3002",
        "order": 400
      },
      {
        "id": "society",
        "parentId": "factions",
        "title": "\u62FE\u6F6E\u793E",
        "kind": "faction",
        "tags": [
          "\u7EC4\u7EC7",
          "\u6C11\u95F4"
        ],
        "body": "\u6CBF\u6D77\u6E14\u6C11\u81EA\u53D1\u7EC4\u6210\u7684\u4E92\u52A9\u56E2\u4F53\u3002\u4ED6\u4EEC\u5BFB\u627E\u5931\u8E2A\u8005\uFF0C\u6536\u7559\u6F6E\u6C50\u5E26\u56DE\u7684\u59D3\u540D\u4E0E\u7269\u4EF6\u3002",
        "order": 500
      },
      {
        "id": "pact",
        "parentId": "rules",
        "title": "\u7184\u706F\u4E4B\u7EA6",
        "kind": "rule",
        "tags": [
          "\u7981\u5FCC",
          "\u5173\u952E\u7EBF\u7D22"
        ],
        "body": "\u5F53\u706F\u5854\u5728\u51CC\u6668\u4E09\u70B9\u7184\u706D\uFF0C\u5CB8\u4E0A\u7684\u4EBA\u5FC5\u987B\u4FDD\u6301\u5B89\u9759\uFF0C\u76F4\u5230\u7B2C\u4E00\u58F0\u949F\u54CD\u3002\u6253\u7834\u7EA6\u5B9A\u7684\u4EBA\uFF0C\u4F1A\u5728\u7B2C\u4E8C\u5929\u5FD8\u8BB0\u4E00\u4E2A\u91CD\u8981\u7684\u540D\u5B57\u3002",
        "order": 600
      },
      {
        "id": "tide-law",
        "parentId": "rules",
        "title": "\u8FD4\u6F6E\u89C4\u5F8B",
        "kind": "rule",
        "tags": [
          "\u89C4\u5219",
          "\u6F6E\u6C50"
        ],
        "body": "\u6BCF\u9694\u5341\u4E5D\u5929\uFF0C\u9000\u6F6E\u4F1A\u6BD4\u6F6E\u6C50\u8868\u65E9\u5230\u4E03\u5206\u949F\u3002\u53EA\u6709\u65E7\u6E2F\u7684\u949F\u4ECD\u51C6\u786E\u8BB0\u5F55\u7740\u8FD9\u6BB5\u7A7A\u767D\u3002",
        "order": 700
      },
      {
        "id": "names",
        "parentId": "rules",
        "title": "\u5F52\u540D\u4EEA\u5F0F",
        "kind": "rule",
        "tags": [
          "\u89C4\u5219",
          "\u8BB0\u5FC6"
        ],
        "body": "\u5931\u8E2A\u8005\u7684\u540D\u5B57\u88AB\u5199\u5728\u8584\u6728\u7247\u4E0A\uFF0C\u6CBF\u5824\u5CB8\u653E\u5165\u6D77\u4E2D\u3002\u82E5\u6728\u7247\u5728\u9ECE\u660E\u524D\u56DE\u6765\uFF0C\u5BB6\u4EBA\u4FBF\u4E0D\u518D\u7B49\u5F85\u3002",
        "order": 800
      },
      {
        "id": "storm",
        "parentId": "history",
        "title": "\u4E09\u5E74\u524D\u7684\u98CE\u66B4",
        "kind": "history",
        "tags": [
          "\u5386\u53F2",
          "\u5173\u952E\u7EBF\u7D22"
        ],
        "body": "\u4E00\u573A\u6CA1\u6709\u6C14\u8C61\u8BB0\u5F55\u7684\u98CE\u66B4\u8BA9\u4E03\u8258\u8239\u5931\u53BB\u8054\u7CFB\u3002\u706F\u5854\u7684\u503C\u73ED\u8BB0\u5F55\u663E\u793A\uFF0C\u90A3\u4E00\u591C\u6709\u4EBA\u63D0\u524D\u63A5\u8FC7\u4E86\u94A5\u5319\u3002",
        "order": 900
      },
      {
        "id": "founding",
        "parentId": "history",
        "title": "\u7B2C\u4E00\u4EFB\u5B88\u706F\u4EBA",
        "kind": "history",
        "tags": [
          "\u5386\u53F2",
          "\u5B88\u671B"
        ],
        "body": "\u5EFA\u5854\u7684\u4EBA\u6CA1\u6709\u7559\u4E0B\u540D\u5B57\uFF0C\u53EA\u5728\u77F3\u9636\u6700\u5E95\u5C42\u523B\u4E86\u4E00\u9053\u5411\u6D77\u7684\u7BAD\u5934\u3002\u7B2C\u4E00\u672C\u503C\u73ED\u518C\u4ECE\u7B2C\u4E8C\u9875\u5F00\u59CB\u3002",
        "order": 1e3
      },
      {
        "id": "closure",
        "parentId": "history",
        "title": "\u65E7\u6E2F\u5C01\u822A\u4EE4",
        "kind": "history",
        "tags": [
          "\u5386\u53F2",
          "\u8C03\u67E5"
        ],
        "body": "\u4E03\u5E74\u524D\uFF0C\u822A\u8FD0\u5C40\u5BA3\u5E03\u65E7\u6E2F\u6C34\u6DF1\u4E0D\u8DB3\u3002\u5C01\u822A\u4EE4\u7684\u7B7E\u53D1\u65E5\u671F\uFF0C\u6BD4\u6700\u540E\u4E00\u8258\u8239\u79BB\u5F00\u7684\u65E5\u5B50\u65E9\u4E86\u4E00\u5468\u3002",
        "order": 1100
      },
      {
        "id": "logbook",
        "parentId": "objects",
        "title": "\u65E0\u7F16\u53F7\u822A\u6D77\u65E5\u5FD7",
        "kind": "object",
        "tags": [
          "\u7269\u4EF6",
          "\u5173\u952E\u7EBF\u7D22"
        ],
        "body": "\u5C01\u76AE\u88AB\u6D77\u6C34\u6D78\u6210\u7070\u84DD\u8272\uFF0C\u6700\u540E\u4E00\u9875\u6495\u53BB\u4E86\u4E00\u534A\u3002\u6BCF\u6B21\u5728\u706F\u5854\u5185\u7FFB\u5F00\uFF0C\u7EB8\u9875\u4E0A\u90FD\u4F1A\u591A\u51FA\u4E00\u884C\u5C1A\u672A\u53D1\u751F\u7684\u8BB0\u5F55\u3002",
        "order": 1200
      },
      {
        "id": "key",
        "parentId": "objects",
        "title": "\u7B2C\u4E03\u628A\u94DC\u94A5\u5319",
        "kind": "object",
        "tags": [
          "\u7269\u4EF6",
          "\u5B88\u671B"
        ],
        "body": "\u534F\u4F1A\u5171\u6709\u516D\u628A\u767B\u8BB0\u8FC7\u7684\u94A5\u5319\u3002\u6797\u7167\u4FDD\u7BA1\u7684\u7B2C\u4E03\u628A\uFF0C\u6BD4\u5176\u4ED6\u94A5\u5319\u66F4\u65E7\uFF0C\u9F7F\u7EB9\u5374\u6CA1\u6709\u4EFB\u4F55\u78E8\u635F\u3002",
        "order": 1300
      },
      {
        "id": "letter",
        "parentId": "objects",
        "title": "\u8FDF\u5230\u4E09\u5E74\u7684\u6765\u4FE1",
        "kind": "object",
        "tags": [
          "\u7269\u4EF6",
          "\u8C03\u67E5"
        ],
        "body": "\u6C88\u781A\u6536\u5230\u7236\u4EB2\u5BC4\u51FA\u7684\u4FE1\uFF0C\u90AE\u6233\u505C\u5728\u98CE\u66B4\u53D1\u751F\u7684\u524D\u4E00\u5929\u3002\u4FE1\u7EB8\u91CC\u5939\u7740\u4E00\u5F20\u53BB\u5F80\u96FE\u6E2F\u7684\u5355\u7A0B\u8239\u7968\u3002",
        "order": 1400
      },
      {
        "id": "bell",
        "parentId": "beliefs",
        "title": "\u4E09\u70B9\u949F\u58F0",
        "kind": "belief",
        "tags": [
          "\u6C11\u4FD7",
          "\u6F6E\u6C50"
        ],
        "body": "\u4EBA\u4EEC\u8BF4\uFF0C\u949F\u58F0\u4E3A\u4ECD\u5728\u6D77\u4E0A\u7684\u4EBA\u62A5\u65F6\u3002\u5B9E\u9645\u4E0A\uFF0C\u96FE\u6E2F\u7684\u949F\u697C\u65E9\u5728\u4E03\u5E74\u524D\u5C31\u62C6\u9664\u4E86\u949F\u9524\u3002",
        "order": 1500
      },
      {
        "id": "lantern",
        "parentId": "beliefs",
        "title": "\u5F15\u6F6E\u706F",
        "kind": "belief",
        "tags": [
          "\u6C11\u4FD7",
          "\u751F\u6D3B"
        ],
        "body": "\u6BCF\u4E2A\u79BB\u6E2F\u7684\u4EBA\u90FD\u8981\u5728\u7A97\u524D\u7559\u4E00\u76CF\u5C0F\u706F\u3002\u706F\u53EF\u4EE5\u7184\u706D\uFF0C\u4F46\u4E0D\u80FD\u88AB\u4E3B\u52A8\u5E26\u8D70\u3002",
        "order": 1600
      },
      {
        "id": "festival",
        "parentId": "beliefs",
        "title": "\u65E0\u540D\u8005\u4E4B\u591C",
        "kind": "belief",
        "tags": [
          "\u6C11\u4FD7",
          "\u8BB0\u5FC6"
        ],
        "body": "\u5165\u51AC\u540E\u7684\u7B2C\u4E00\u4E2A\u65E0\u6708\u4E4B\u591C\uFF0C\u5C45\u6C11\u7528\u65E7\u540D\u5B57\u4E92\u76F8\u79F0\u547C\u3002\u6709\u4EBA\u56E0\u6B64\u60F3\u8D77\u518D\u4E5F\u6CA1\u6709\u56DE\u6765\u7684\u4EBA\u3002",
        "order": 1700
      },
      {
        "id": "architecture",
        "parentId": "lighthouse",
        "title": "\u5EFA\u7B51\u4E0E\u7A7A\u95F4",
        "kind": "entry",
        "tags": [],
        "body": "\u5854\u8EAB\u6709\u4E03\u5341\u4E8C\u7EA7\u53F0\u9636\u3002\u9876\u5C42\u706F\u5BA4\u671D\u5317\u5F00\u7A97\uFF0C\u897F\u4FA7\u662F\u4E00\u95F4\u6CA1\u6709\u95E8\u724C\u7684\u503C\u73ED\u5BA4\u3002",
        "order": 0
      },
      {
        "id": "watch",
        "parentId": "lighthouse",
        "title": "\u5B88\u706F\u89C4\u7A0B",
        "kind": "entry",
        "tags": [],
        "body": "\u4EA4\u73ED\u524D\u6E05\u70B9\u94A5\u5319\uFF1B\u4E09\u70B9\u524D\u4E0D\u72EC\u81EA\u8FDB\u5165\u706F\u5BA4\uFF1B\u98CE\u66B4\u4E2D\u4E0D\u5F97\u5411\u65E7\u6E2F\u53D1\u51FA\u4FE1\u53F7\u3002",
        "order": 100
      },
      {
        "id": "secret",
        "parentId": "watch",
        "title": "\u672A\u8BB0\u5165\u518C\u7684\u7B2C\u4E03\u6761",
        "kind": "entry",
        "tags": [],
        "body": "\u5982\u679C\u6709\u4EBA\u4ECE\u6D77\u4E0A\u547C\u5524\u4F60\u7684\u540D\u5B57\uFF0C\u4E0D\u8981\u56DE\u5934\u3002",
        "order": 200
      },
      {
        "id": "trace",
        "parentId": "lighthouse",
        "title": "\u6545\u4E8B\u4E2D\u7684\u7EBF\u7D22",
        "kind": "entry",
        "tags": [],
        "body": "\u6797\u7167\u5728\u706F\u5BA4\u53D1\u73B0\u4E86\u7236\u4EB2\u7684\u65E7\u7B14\u8FF9\u3002\u5979\u8BA4\u51FA\u4E86\u843D\u6B3E\uFF0C\u5374\u6CA1\u6709\u544A\u8BC9\u6C88\u781A\u3002",
        "order": 300
      },
      {
        "id": "ledger",
        "parentId": "keepers",
        "title": "\u540D\u518C\u4E0E\u804C\u8D23",
        "kind": "entry",
        "tags": [],
        "body": "\u534F\u4F1A\u4EE5\u8F6E\u503C\u7684\u65B9\u5F0F\u7EF4\u62A4\u706F\u5854\uFF0C\u6BCF\u6B21\u4EA4\u73ED\u90FD\u9700\u8981\u4E24\u540D\u89C1\u8BC1\u4EBA\u3002",
        "order": 400
      },
      {
        "id": "cost",
        "parentId": "pact",
        "title": "\u8FDD\u7EA6\u7684\u4EE3\u4EF7",
        "kind": "entry",
        "tags": [],
        "body": "\u88AB\u9057\u5FD8\u7684\u540D\u5B57\u4E0D\u4F1A\u4ECE\u7EB8\u4E0A\u6D88\u5931\uFF0C\u53EA\u4F1A\u4ECE\u6240\u6709\u4EBA\u7684\u8BB0\u5FC6\u4E2D\u9000\u53BB\u3002",
        "order": 500
      },
      {
        "id": "lin",
        "title": "\u6797\u7167",
        "kind": "person",
        "parentId": null,
        "tags": [
          "\u4EBA\u7269",
          "\u5B88\u706F\u4EBA"
        ],
        "body": "\u96FE\u6E2F\u706F\u5854\u7684\u73B0\u4EFB\u5B88\u706F\u4EBA\u3002\u5979\u4ECE\u4E0D\u5728\u4E09\u70B9\u524D\u79BB\u5F00\u706F\u5BA4\uFF0C\u77E5\u9053\u7236\u4EB2\u5931\u8E2A\u7684\u53E6\u4E00\u79CD\u8BF4\u6CD5\u3002"
      },
      {
        "id": "shen",
        "title": "\u6C88\u781A",
        "kind": "person",
        "parentId": null,
        "tags": [
          "\u4EBA\u7269",
          "\u8C03\u67E5"
        ],
        "body": "\u5E26\u7740\u7236\u4EB2\u8FDF\u5230\u7684\u6765\u4FE1\u6765\u5230\u96FE\u6E2F\u3002\u4ED6\u8BD5\u56FE\u786E\u8BA4\u90A3\u573A\u98CE\u66B4\u91CC\uFF0C\u7A76\u7ADF\u6709\u54EA\u4E9B\u4EBA\u4ECE\u672A\u79BB\u5F00\u3002"
      }
    ],
    "relations": [
      {
        "id": "rel1",
        "to": "keepers",
        "label": "\u7531\u5176\u7EF4\u62A4",
        "reverseLabel": "\u8D1F\u8D23\u7EF4\u62A4",
        "from": "lighthouse"
      },
      {
        "id": "rel2",
        "to": "pact",
        "label": "\u9075\u5FAA",
        "reverseLabel": "\u7EA6\u675F",
        "from": "lighthouse"
      },
      {
        "id": "rel3",
        "to": "lighthouse",
        "label": "\u9A7B\u5B88",
        "reverseLabel": "\u5B88\u706F\u4EBA",
        "from": "lin"
      },
      {
        "id": "rel4",
        "to": "harbor",
        "label": "\u773A\u671B",
        "reverseLabel": "\u706F\u5149\u6765\u81EA",
        "from": "lighthouse"
      },
      {
        "id": "rel5",
        "to": "logbook",
        "label": "\u85CF\u6709",
        "reverseLabel": "\u53D1\u73B0\u4E8E",
        "from": "lighthouse"
      },
      {
        "id": "rel6",
        "to": "lighthouse",
        "label": "\u8C03\u67E5",
        "reverseLabel": "\u8C03\u67E5\u8005",
        "from": "shen"
      },
      {
        "id": "rel7",
        "to": "key",
        "label": "\u4FDD\u7BA1",
        "reverseLabel": "\u7531\u5176\u4FDD\u7BA1",
        "from": "keepers"
      },
      {
        "id": "rel8",
        "to": "keepers",
        "label": "\u6210\u5458",
        "reverseLabel": "\u6210\u5458",
        "from": "lin"
      },
      {
        "id": "rel9",
        "to": "bell",
        "label": "\u4EE5\u6B64\u4E3A\u754C",
        "reverseLabel": "\u6807\u8BB0",
        "from": "pact"
      },
      {
        "id": "rel10",
        "to": "storm",
        "label": "\u8BB0\u5F55",
        "reverseLabel": "\u8BB0\u5F55\u4E8E",
        "from": "logbook"
      },
      {
        "id": "rel11",
        "to": "letter",
        "label": "\u6536\u5230",
        "reverseLabel": "\u6536\u4FE1\u4EBA",
        "from": "shen"
      },
      {
        "id": "rel12",
        "to": "closure",
        "label": "\u53D7\u5176\u5F71\u54CD",
        "reverseLabel": "\u5173\u95ED",
        "from": "harbor"
      },
      {
        "id": "rel13",
        "to": "tide-law",
        "label": "\u9075\u5FAA",
        "reverseLabel": "\u5F71\u54CD",
        "from": "market"
      }
    ]
  };

  // docs/前端美化/设定-三版探索-20261105/model.mjs
  var clone = (value) => structuredClone(value);
  var LoreModel = class {
    constructor(seed) {
      this.data = clone(seed);
      this.selected = "lighthouse";
      this.setId = "geography";
      this.history = [];
      this.future = [];
    }
    node(id) {
      return this.data.nodes.find((n) => n.id === id);
    }
    children(id) {
      return this.data.nodes.filter((n) => n.parentId === id).sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    path(id) {
      const out = [], seen = /* @__PURE__ */ new Set();
      let n = this.node(id);
      while (n && !seen.has(n.id)) {
        seen.add(n.id);
        out.unshift(n);
        n = this.node(n.parentId);
      }
      return out;
    }
    root(id) {
      return this.path(id).find((n) => n.isSet);
    }
    descendants(id) {
      const out = [], seen = /* @__PURE__ */ new Set([id]);
      const walk = (p) => {
        for (const n of this.children(p)) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          out.push(n);
          walk(n.id);
        }
      };
      walk(id);
      return out;
    }
    search(q, tag2 = "") {
      q = q.trim().toLowerCase();
      return this.data.nodes.filter((n) => !n.isSet && (!q || [n.title, n.body, ...n.tags || []].join(" ").toLowerCase().includes(q)) && (!tag2 || (n.tags || []).includes(tag2)));
    }
    snapshot() {
      return { data: clone(this.data), selected: this.selected, setId: this.setId };
    }
    checkpoint() {
      this.history.push(this.snapshot());
      if (this.history.length > 60) this.history.shift();
      this.future = [];
    }
    restore(s) {
      this.data = clone(s.data);
      this.selected = this.node(s.selected)?.id || this.data.nodes.find((n) => !n.isSet)?.id || null;
      this.setId = this.node(s.setId)?.id || this.data.nodes.find((n) => n.isSet)?.id || null;
    }
    update(id, patch) {
      const n = this.node(id);
      if (!n) return false;
      if (Object.entries(patch).every(([k, v]) => JSON.stringify(n[k]) === JSON.stringify(v))) return false;
      this.checkpoint();
      Object.assign(n, patch);
      return true;
    }
    add(parentId, fields = {}, afterId = null) {
      if (!this.node(parentId) || this.node(parentId).kind === "person") return false;
      this.checkpoint();
      const siblings = this.children(parentId);
      siblings.forEach((n, i) => n.order = i * 100);
      const at = siblings.findIndex((n) => n.id === afterId), order = at < 0 ? (siblings.at(-1)?.order || 0) + 100 : ((siblings[at].order || 0) + (siblings[at + 1]?.order ?? (siblings[at].order || 0) + 200)) / 2;
      const row = { id: "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), parentId, title: "\u672A\u547D\u540D\u8BBE\u5B9A", body: "", tags: [], kind: "entry", order, ...fields };
      this.data.nodes.push(row);
      this.selected = row.id;
      this.setId = this.root(row.id)?.id || this.setId;
      return row;
    }
    move(id, parentId, beforeId = null) {
      const n = this.node(id), p = this.node(parentId);
      if (!n || n.isSet || !p || p.kind === "person" || id === parentId || this.descendants(id).some((c) => c.id === parentId)) return false;
      this.checkpoint();
      n.parentId = parentId;
      const siblings = this.children(parentId).filter((c) => c.id !== id), at = siblings.findIndex((c) => c.id === beforeId);
      siblings.splice(at < 0 ? siblings.length : at, 0, n);
      siblings.forEach((c, i) => c.order = i * 100);
      this.setId = this.root(id)?.id || this.setId;
      return true;
    }
    indent(id) {
      const n = this.node(id);
      if (!n || n.isSet) return false;
      const sib = this.children(n.parentId), i = sib.findIndex((n2) => n2.id === id);
      return i > 0 ? this.move(id, sib[i - 1].id) : false;
    }
    outdent(id) {
      const n = this.node(id), p = n && this.node(n.parentId);
      if (!p || p.isSet || !p.parentId) return false;
      const siblings = this.children(p.parentId), next = siblings[siblings.findIndex((n2) => n2.id === p.id) + 1];
      return this.move(id, p.parentId, next?.id);
    }
    remove(id) {
      const n = this.node(id);
      if (!n || n.isSet) return false;
      this.checkpoint();
      const ids = /* @__PURE__ */ new Set([id, ...this.descendants(id).map((n2) => n2.id)]);
      this.data.nodes = this.data.nodes.filter((n2) => !ids.has(n2.id));
      this.data.relations = this.data.relations.filter((r) => !ids.has(r.from) && !ids.has(r.to));
      if (ids.has(this.selected)) this.selected = this.children(this.setId)[0]?.id || null;
      return true;
    }
    links(id) {
      return this.data.relations.filter((r) => r.from === id || r.to === id).map((r) => ({ ...r, otherId: r.from === id ? r.to : r.from, direction: r.from === id ? "out" : "in", displayLabel: r.from === id ? r.label : r.reverseLabel || r.label }));
    }
    addRelation(from, to, label, reverseLabel = "", description = "") {
      label = label.trim();
      if (from === to || !this.node(from) || !this.node(to) || !label || this.data.relations.some((r2) => r2.from === from && r2.to === to && r2.label === label)) return false;
      this.checkpoint();
      const r = { id: "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), from, to, label, reverseLabel, description };
      this.data.relations.push(r);
      return r;
    }
    removeRelation(id) {
      if (!this.data.relations.some((r) => r.id === id)) return false;
      this.checkpoint();
      this.data.relations = this.data.relations.filter((r) => r.id !== id);
      return true;
    }
    undo() {
      if (!this.history.length) return false;
      this.future.push(this.snapshot());
      this.restore(this.history.pop());
      return true;
    }
    redo() {
      if (!this.future.length) return false;
      this.history.push(this.snapshot());
      this.restore(this.future.pop());
      return true;
    }
  };

  // docs/前端美化/设定-三版探索-20261105/icons.mjs
  var outlineGlyphs = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="m10 3 4 0 .6 3 2 .9 2.8-1 2 3.4-2.2 2v2.4l2.2 2-2 3.4-2.8-1-2 .9-.6 3h-4l-.6-3-2-.9-2.8 1-2-3.4 2.2-2v-2.4L2.6 9.3l2-3.4 2.8 1 2-.9z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    tree: '<rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v5M4 16v-3h16v3"/><rect x="1" y="16" width="6" height="5" rx="1"/><rect x="17" y="16" width="6" height="5" rx="1"/>',
    event: '<path d="m12 3 9 9-9 9-9-9z"/>',
    note: '<path d="M5 3h14v13l-5 5H5zM14 21v-5h5M8 8h8M8 12h6"/>',
    link: '<path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1" transform="translate(1 0) scale(.9)"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M4 13v2a8 6 0 0 0 16 0v-2M2 15l2-2 2 2m12 0 2-2 2 2"/>',
    container: '<rect x="3" y="5" width="18" height="15" rx="3" stroke-dasharray="3 2"/><path d="M8 2h8"/>',
    text: '<path d="M4 5h16M12 5v16M8 21h8"/>',
    volume: '<path d="M4 4h14a2 2 0 0 1 2 2v15H6a2 2 0 0 1-2-2zm0 12h16M8 4v12"/>',
    pointer: '<path d="m5 3 14 10-7 1-3 7z"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    tidy: '<rect x="3" y="4" width="6" height="6" rx="1"/><rect x="15" y="4" width="6" height="6" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/><path d="M6 10v3h12v-3M12 13v3"/>',
    undo: '<path d="M8 5 3 10l5 5M3 10h12a6 6 0 0 1 0 12"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>'
  };

  // docs/前端美化/设定-三版探索-20261105/prototype.mjs
  var $ = (s) => document.querySelector(s);
  var $$ = (s) => [...document.querySelectorAll(s)];
  var esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var extra = { folder: '<path d="M3 6h7l2 3h9v11H3z"/>', place: '<path d="M12 22s8-8 8-13A8 8 0 0 0 4 9c0 5 8 13 8 13Z"/><circle cx="12" cy="9" r="2.5"/>', faction: '<path d="M4 21V5l8-3 8 3v16M8 21v-6h8v6M8 7h1m6 0h1M8 11h1m6 0h1"/>', rule: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 11l3 3 5-6"/>', history: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>', object: '<path d="m3 7 9-5 9 5v11l-9 4-9-4zm0 0 9 5 9-5M12 12v10"/>', belief: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>', person: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>', entry: '<path d="M5 3h14v18H5zM8 8h8m-8 4h8m-8 4h5"/>', back: '<path d="m10 5-7 7 7 7M3 12h18"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', undo: '<path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/>', redo: '<path d="m16 3 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>', trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 16h10l1-16M10 10v8m4-8v8"/>', grip: '<path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01"/>', filter: '<path d="M3 5h18M6 12h12M9 19h6"/>' };
  var icon = (name, size = 16) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra[name] || outlineGlyphs[name] || extra.entry}</svg>`;
  var V = document.body.dataset.variant;
  var KEY = "latent:lore-exploration:20261105:" + V + ":v1";
  var model = new LoreModel(content_default);
  var defaults = { nav: V === "A" ? 236 : V === "B" ? 220 : 180, list: 300, detail: 348 };
  var previousDrawer = null;
  var prefs = { widths: { ...defaults }, navClosed: false, listClosed: false, detailClosed: false, folded: [], positions: {}, pan: { x: 0, y: 0, zoom: 1 } };
  var query = "";
  var tag = "";
  var relatedOpen = false;
  var screen = V === "B" ? "list" : V === "C" ? "detail" : "reader";
  var drawer = null;
  var editing = null;
  var inlineDraft = null;
  var graphFocus = "lighthouse";
  var backStack = [];
  var scrolls = /* @__PURE__ */ new Map();
  var storageError = false;
  var sessionOnly = location.protocol === "about:" || window.origin === "null" && location.protocol !== "file:";
  var toastTimer;
  var saveTimer;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved?.data) {
      model.restore(saved);
      prefs = { ...prefs, ...saved.prefs, widths: { ...defaults, ...saved.prefs?.widths } };
      graphFocus = model.selected || "lighthouse";
    }
  } catch {
    sessionOnly = true;
  }
  var kinds = { place: "\u5730\u70B9", faction: "\u7EC4\u7EC7", rule: "\u89C4\u5219", history: "\u5386\u53F2", object: "\u7269\u4EF6", belief: "\u6C11\u4FD7", person: "\u4EBA\u7269", entry: "\u5B50\u8BBE\u5B9A" };
  var btn = (label, act2, cl = "", id = "", glyph = "") => `<button type="button" class="btn ${cl}" data-action="${act2}" ${id ? `data-id="${esc(id)}"` : ""}>${glyph ? icon(glyph, 14) : ""}${esc(label)}</button>`;
  var ib = (label, act2, id = "", glyph = "more") => `<button type="button" class="icon-button" aria-label="${esc(label)}" title="${esc(label)}" data-action="${act2}" data-id="${esc(id)}">${icon(glyph, 15)}</button>`;
  var tags = (n) => `<div class="tags">${(n.tags || []).map((t) => `<button class="tag ${tag === t ? "active" : ""}" data-action="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
  var isNarrow = () => innerWidth < 1100;
  function persist() {
    if (sessionOnly) {
      updateSave();
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...model.snapshot(), prefs }));
      storageError = false;
    } catch {
      storageError = true;
    }
    updateSave();
  }
  function updateSave() {
    const n = editing && model.node(editing.id), dirty = !!(n && (editing.title !== n.title || (editing.body || "") !== (n.body || ""))) || !!(inlineDraft && inlineDraft.value !== model.node(inlineDraft.id)?.title), el = $("#save-status");
    if (el) el.innerHTML = icon(storageError ? "close" : dirty ? "edit" : "check", 13) + (dirty ? "\u5F85\u4FDD\u5B58" : storageError ? "\u4FDD\u5B58\u5931\u8D25" : sessionOnly ? "\u5DF2\u66F4\u65B0" : "\u5DF2\u4FDD\u5B58");
    el?.classList.toggle("storage-error", storageError);
  }
  function toast(message, undo = false) {
    clearTimeout(toastTimer);
    $("#toast").className = "toast";
    $("#toast").innerHTML = `<span>${esc(message)}</span>${undo ? '<button data-action="undo">\u64A4\u9500</button>' : ""}`;
    toastTimer = setTimeout(() => {
      $("#toast").className = "";
      $("#toast").innerHTML = "";
    }, 4500);
  }
  function rememberScroll() {
    for (const el of $$("[data-scroll]")) scrolls.set(el.dataset.scroll, { x: el.scrollLeft, y: el.scrollTop });
  }
  function restoreScroll() {
    for (const el of $$("[data-scroll]")) {
      const s = scrolls.get(el.dataset.scroll);
      if (s) {
        el.scrollTop = s.y;
        el.scrollLeft = s.x;
      }
    }
  }
  function commitDraft(renderAfter = false) {
    const closedForm = !!editing;
    if (editing) {
      const d = editing;
      editing = null;
      model.update(d.id, { title: d.title.trim() || "\u672A\u547D\u540D\u8BBE\u5B9A", body: d.body });
      persist();
    }
    if (inlineDraft) {
      const d = inlineDraft;
      inlineDraft = null;
      model.update(d.id, { title: d.value.trim() || "\u672A\u547D\u540D\u8BBE\u5B9A" });
      persist();
    }
    if (renderAfter || closedForm) render();
  }
  function selectNode(id, { remember = true, focus = false } = {}) {
    if (!model.node(id)) return;
    rememberScroll();
    commitDraft();
    if (remember && model.selected && model.selected !== id) backStack.push(model.selected);
    model.selected = id;
    model.setId = model.root(id)?.id || model.setId;
    if (focus) graphFocus = id;
    if (isNarrow()) screen = V === "C" ? "detail" : V === "B" ? "detail" : "reader";
    drawer = null;
    persist();
    render();
  }
  function setCategory(id) {
    rememberScroll();
    commitDraft();
    model.setId = id;
    query = "";
    tag = "";
    model.selected = model.children(id)[0]?.id || null;
    if (V === "C") graphFocus = model.selected;
    if (isNarrow()) {
      drawer = null;
      screen = V === "B" ? "list" : V === "C" ? "graph" : "reader";
    }
    persist();
    render();
  }
  function renderTop() {
    const nav = [["shelf", "\u4E66\u67B6"], ["chapters", "\u6B63\u6587"], ["outline", "\u5927\u7EB2"], ["lore", "\u8BBE\u5B9A"], ["characters", "\u4EBA\u7269"], ["snippets", "\u7075\u611F"]];
    $("#topbar").innerHTML = `<a class="brand" href="style-explorer.html">\u5C0F\u8BF4\u5DE5\u574A <small>LATENT</small></a><nav class="global-nav" aria-label="\u529F\u80FD\u6A21\u5757">${nav.map(([key, name]) => `<button data-action="module" data-id="${key}" class="${key === "lore" ? "active" : ""}" ${key === "lore" ? 'aria-current="page"' : 'disabled aria-disabled="true"'}>${name}</button>`).join("")}</nav><div class="top-actions"><span class="save-status" id="save-status" role="status"></span><button class="round" aria-label="\u641C\u7D22\u6240\u6709\u8BBE\u5B9A" data-action="search">${icon("search", 18)}</button><button class="round" aria-label="\u8BBE\u7F6E" data-action="settings">${icon("gear", 18)}</button></div>`;
    updateSave();
  }
  function renderMobile() {
    const back = V === "B" && screen === "detail" ? btn("\u6761\u76EE\u5217\u8868", "back-list", "", "", "back") : V === "C" && screen === "detail" ? btn("\u5173\u7CFB\u56FE\u8C31", "back-graph", "", "", "back") : btn("\u8BBE\u5B9A\u76EE\u5F55", "open-nav", "", "", "tree");
    $("#mobile-bar").innerHTML = `${back}<span>${V === "A" ? "\u8BBE\u5B9A\u4E66\u623F" : V === "B" ? "\u4E16\u754C\u6863\u6848" : "\u5173\u7CFB\u89C2\u6D4B\u53F0"}</span>${V === "B" || V === "C" ? btn("\u76EE\u5F55", "open-nav") : btn("\u5173\u8054", "related")}`;
  }
  function renderNav() {
    const roots = model.data.nodes.filter((n) => n.isSet), compact = V === "C", count = model.data.nodes.filter((n) => !n.isSet && n.kind !== "person").length;
    $("#nav-pane").innerHTML = `<button class="nav-rail" data-action="toggle-nav" aria-label="\u5C55\u5F00\u8BBE\u5B9A\u76EE\u5F55">${icon("tree", 17)}<span>\u4E16\u754C\u8BBE\u5B9A</span>${icon("chevron", 13)}</button><div class="nav-head">${icon("folder", 16)}<h2>${compact ? "\u4E16\u754C\u7D22\u5F15" : "\u4E16\u754C\u8BBE\u5B9A"}</h2>${ib("\u6536\u8D77\u8BBE\u5B9A\u76EE\u5F55", "toggle-nav", "", "chevron")}</div><label class="nav-search">${icon("search", 14)}<input id="nav-search" data-focus-key="nav-search" placeholder="\u641C\u7D22\u8BBE\u5B9A\u3001\u6807\u7B7E\u2026" value="${esc(query)}" aria-label="\u641C\u7D22\u8BBE\u5B9A\u6216\u6807\u7B7E" autocomplete="off">${query || tag ? ib("\u6E05\u9664\u68C0\u7D22", "clear", "", "close") : ""}</label><div class="nav-section-label">\u8BBE\u5B9A\u96C6 <span>${roots.length}${ib("\u65B0\u5EFA\u8BBE\u5B9A", "new-entry", "", "plus")}</span></div><div class="nav-tree" data-scroll="nav">${roots.map((root) => `<button class="category ${model.setId === root.id ? "current" : ""}" data-action="category" data-id="${root.id}" aria-pressed="${model.setId === root.id}">${icon(root.kind, 15)}<span>${esc(root.title)}</span><small>${model.children(root.id).length}</small></button>${!compact && model.setId === root.id && !prefs.folded.includes(root.id) ? `<div class="nav-children">${model.children(root.id).map((n) => `<button class="nav-entry ${model.selected === n.id ? "selected" : ""}" data-action="select" data-id="${n.id}" title="${esc(n.title)}">${esc(n.title)}</button>`).join("")}</div>` : ""}`).join("")}${query || tag ? `<div class="nav-section-label" style="padding:15px 8px 5px">\u68C0\u7D22\u7ED3\u679C <span>${model.search(query, tag).length}</span></div>${model.search(query, tag).map((n) => `<button class="nav-entry" data-action="select" data-id="${n.id}">${esc(n.title)}</button>`).join("")}` : ""}</div><div class="nav-foot">${icon("link", 13)}<span>${model.data.relations.length} \u6761\u4E16\u754C\u5173\u7CFB</span><span>${count} \u6761\u76EE</span></div>`;
  }
  function renderHead() {
    const root = model.node(model.setId), title = V === "A" ? "\u8BBE\u5B9A\u4E66\u623F" : V === "B" ? "\u4E16\u754C\u6863\u6848" : "\u5173\u7CFB\u89C2\u6D4B\u53F0", action = V === "C" ? btn("\u65B0\u5EFA\u5173\u7CFB", "new-relation", "primary", "", "plus") + ib("\u56FE\u8C31\u64CD\u4F5C", "graph-settings", "", "more") : V === "A" ? btn("\u5173\u8054\u8D44\u6599", "related", relatedOpen ? "primary" : "", "", "link") + btn("\u65B0\u5EFA\u8BBE\u5B9A", "new-entry", "primary", "", "plus") : btn("\u65B0\u5EFA\u8BBE\u5B9A", "new-entry", "primary", "", "plus");
    $("#main-head").innerHTML = `<div><div class="crumbs"><span>\u957F\u591C\u5C06\u660E</span>${icon("chevron", 10)}<button data-action="open-nav">${esc(model.node(model.selected)?.kind === "person" ? "\u5173\u8054\u4EBA\u7269" : root?.title || "\u5168\u90E8\u8BBE\u5B9A")}</button></div><h1>${title}</h1>${V === "C" ? `<div class="graph-title-chip"><span class="dot"></span>\u4EE5\u300C${esc(model.node(graphFocus)?.title || "\u5F53\u524D\u6761\u76EE")}\u300D\u4E3A\u4E2D\u5FC3 \xB7 ${model.links(graphFocus).length} \u6761\u5173\u8054</div>` : ""}</div><div class="head-tools">${action}</div>`;
  }
  function relationRows(id, limit = 99) {
    return model.links(id).slice(0, limit).map((r) => {
      const n = model.node(r.otherId);
      if (!n) return "";
      return `<div class="rel-row" data-rel="${r.id}" data-related="${n.id}"><button class="rel-target" data-action="select" data-id="${n.id}" title="\u67E5\u770B${esc(n.title)}"><span class="rel-mark">${icon(n.kind, 13)}</span><small>${esc(r.displayLabel)}</small><strong>${esc(n.title)}</strong>${icon("chevron", 11)}</button><button class="icon-button rel-delete" data-action="remove-relation" data-id="${r.id}" aria-label="\u79FB\u9664\u4E0E${esc(n.title)}\u7684\u5173\u7CFB">${icon("close", 11)}</button></div>`;
    }).join("") || '<div class="empty">\u5C1A\u672A\u5EFA\u7ACB\u5173\u8054</div>';
  }
  function editForm(n) {
    return `<form class="edit-form" id="edit-form" data-id="${n.id}"><label>\u6761\u76EE\u6807\u9898<input data-edit="title" aria-label="\u6761\u76EE\u6807\u9898" value="${esc(editing.title)}" autocomplete="off"></label><label>\u6B63\u6587<textarea data-edit="body" aria-label="\u8BBE\u5B9A\u6B63\u6587" rows="${V === "C" ? 8 : 7}">${esc(editing.body)}</textarea></label><div class="edit-actions">${btn("\u53D6\u6D88", "cancel-edit")}${btn("\u4FDD\u5B58\u4FEE\u6539", "save-edit", "primary", "", "check")}</div></form>`;
  }
  function entryBody(n) {
    return editing?.id === n.id ? editForm(n) : `<h2 class="content-title"><button class="editable-title" data-action="edit" data-id="${n.id}" aria-label="\u7F16\u8F91${esc(n.title)}">${esc(n.title)}</button></h2>${tags(n)}<button class="editable-body" data-action="edit-body" data-id="${n.id}" aria-label="\u7F16\u8F91\u6B63\u6587"><p class="body-copy">${esc(n.body || "\u5199\u4E0B\u8FD9\u9879\u8BBE\u5B9A\u7684\u5185\u5BB9\u2026")}</p></button>`;
  }
  function renderA() {
    const n = model.node(model.selected), root = model.node(model.setId);
    $(".study-pane").classList.toggle("related-open", relatedOpen);
    $("#reader").dataset.scroll = "reader-" + model.selected;
    if (!n) {
      $("#reader").innerHTML = emptyEntry();
      $("#related-dock").innerHTML = "";
      return;
    }
    const children = model.children(n.id);
    $("#reader").innerHTML = `<article class="manuscript fade-in"><div class="paper-kicker"><span>${esc(n.kind === "person" ? "\u5173\u8054\u4EBA\u7269" : root?.title || kinds[n.kind])} / ${esc(kinds[n.kind] || "\u8BBE\u5B9A")}</span><span>${String(model.data.nodes.filter((n2) => !n2.isSet && n2.kind !== "person").indexOf(n) + 1).padStart(2, "0")} ${btn("\u7F16\u8F91", "edit", "paper-edit", n.id, "edit")} ${ib("\u6761\u76EE\u66F4\u591A\u64CD\u4F5C", "entry-menu", n.id)}</span></div><div class="intro">${entryBody(n)}</div>${children.length ? children.map((c, i) => `<section class="paper-section"><h3><span>${String(i + 1).padStart(2, "0")}</span>${esc(c.title)}${ib("\u6298\u53E0" + c.title, "fold", c.id, "chevron")}</h3>${!prefs.folded.includes(c.id) ? `<p>${esc(c.body)}</p>${model.children(c.id).map((ch) => inlineRow(ch, 1)).join("")}` : ""}</section>`).join("") : `<section class="paper-section"><h3><span>01</span>\u5EF6\u4F38\u8BBE\u5B9A</h3><p>\u5C06\u7EC6\u8282\u5199\u6210\u5B50\u6761\u76EE\uFF0C\u8BA9\u4E16\u754C\u9010\u6E10\u5B8C\u6574\u3002</p></section>`}<section class="paper-section"><h3><span>\xA7</span>\u8BBE\u5B9A\u6761\u76EE${btn("\u6DFB\u52A0\u5B50\u6761\u76EE", "new-child", "", "", "plus")}</h3>${inlineRow(n, 0)}${children.map((c) => inlineRow(c, 1)).join("")}</section></article>`;
    $("#related-dock").innerHTML = `<div class="section-head">\u5173\u8054\u8D44\u6599 <small>${model.links(n.id).length}</small>${ib("\u5173\u95ED\u5173\u8054\u8D44\u6599", "related", "", "close")}</div><div class="tiny-label">${esc(n.title)}</div><h2 class="content-title" style="font-size:22px">\u4E16\u754C\u4E2D\u7684\u8054\u7CFB</h2>${relationRows(n.id)}<div class="relation-actions">${btn("\u5EFA\u7ACB\u5173\u7CFB", "new-relation", "", "", "plus")}</div><div class="reader-section"><h3 class="section-head">\u6240\u5728\u8DEF\u5F84</h3><div class="context-line">${model.path(n.id).map((c) => esc(c.title)).join(" / ")}</div></div>`;
    $("#main-foot").innerHTML = `<span>${n.body?.length || 0} \u5B57 \xB7 ${model.descendants(n.id).length} \u9879\u5B50\u8BBE\u5B9A</span><div>${ib("\u64A4\u9500", "undo", "", "undo")}${ib("\u91CD\u505A", "redo", "", "redo")}</div>`;
  }
  function inlineRow(n, depth) {
    return `<div class="child-editor ${model.selected === n.id ? "selected" : ""}" data-row="${n.id}" style="margin-left:${depth * 15}px"><span class="drag-handle" draggable="true" data-drag="${n.id}" aria-label="\u62D6\u52A8${esc(n.title)}">${icon("grip", 13)}</span><div class="line-edit" contenteditable="true" role="textbox" data-inline="${n.id}" aria-label="\u6761\u76EE ${esc(n.title)}" spellcheck="false">${esc(n.title)}</div>${ib("\u67E5\u770B\u6761\u76EE", "select", n.id, "chevron")}</div>`;
  }
  function renderB() {
    const root = model.node(model.setId), list = query || tag ? model.search(query, tag) : model.children(model.setId);
    $("#list-pane").innerHTML = `<button class="nav-rail list-rail" data-action="toggle-list" aria-label="\u5C55\u5F00\u6761\u76EE\u5217\u8868">${icon("entry", 16)}<span>\u6761\u76EE\u5217\u8868</span></button><header class="list-heading"><div class="context-line">\u8BBE\u5B9A\u96C6 <span class="dot"></span> ${list.length} \u4E2A\u6761\u76EE</div><div class="list-title"><h2>${query || tag ? "\u68C0\u7D22\u7ED3\u679C" : esc(root?.title || "\u4E16\u754C\u8BBE\u5B9A")}</h2>${ib("\u6536\u8D77\u6761\u76EE\u5217\u8868", "toggle-list", "", "chevron")}</div><div class="list-filter">${icon("filter", 12)}<select aria-label="\u7B5B\u9009\u6807\u7B7E" id="tag-filter"><option value="">\u5168\u90E8\u6807\u7B7E</option>${[...new Set(model.data.nodes.flatMap((n) => n.tags || []))].filter((t) => t !== "\u4EBA\u7269").map((t) => `<option ${tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>${query || tag ? ib("\u6E05\u9664\u7B5B\u9009", "clear", "", "close") : ""}</div></header><div class="list-entries" data-scroll="list-${query || tag ? "search" : model.setId}">${list.length ? list.map((n) => `<button class="list-entry ${model.selected === n.id ? "selected" : ""}" data-action="select" data-id="${n.id}" aria-pressed="${model.selected === n.id}"><div class="list-entry-head"><h3>${esc(n.title)}</h3>${model.selected === n.id ? icon("chevron", 12) : ""}</div><p class="list-desc">${esc(n.body)}</p><div class="list-entry-meta">${(n.tags || []).slice(0, 2).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}<span>${model.links(n.id).length} \u5173\u8054</span></div></button>`).join("") : `<div class="empty"><h3>\u6CA1\u6709\u627E\u5230\u8FD9\u9879\u8BBE\u5B9A</h3>\u6362\u4E2A\u8BCD\uFF0C\u6216\u6E05\u9664\u5F53\u524D\u7B5B\u9009\u3002${btn("\u6E05\u9664\u7B5B\u9009", "clear")}</div>`}</div><footer class="list-bottom">${btn("\u65B0\u5EFA\u6761\u76EE", "new-entry", "", "", "plus")}</footer>`;
    renderBReader();
  }
  function renderBReader() {
    const n = model.node(model.selected);
    $("#reader").dataset.scroll = "reader-" + model.selected;
    if (!n) {
      $("#reader").innerHTML = emptyEntry();
      $("#main-foot").innerHTML = "";
      return;
    }
    $("#reader").innerHTML = `<article class="archive-article fade-in">${backStack.length ? `<button class="related-back" data-action="back-entry">${icon("back", 12)} \u8FD4\u56DE\u4E0A\u4E00\u6761\u76EE</button>` : ""}<div class="entry-menu"><div class="context-line">${icon(n.kind, 14)}${esc(kinds[n.kind] || "\u8BBE\u5B9A")}<span class="dot"></span>${model.children(n.id).length} \u9879\u5B50\u8BBE\u5B9A</div><div class="actions">${ib("\u7F16\u8F91\u5F53\u524D\u6761\u76EE", "edit", n.id, "edit")}${ib("\u6761\u76EE\u66F4\u591A\u64CD\u4F5C", "entry-menu", n.id)}</div></div>${entryBody(n)}<section class="reader-section"><h3 class="section-head">\u5173\u8054\u5173\u7CFB <small>${model.links(n.id).length}</small>${ib("\u6DFB\u52A0\u5173\u8054\u5173\u7CFB", "new-relation", "", "plus")}</h3><div class="rel-grid">${relationRows(n.id)}</div></section><section class="reader-section"><h3 class="section-head">\u5B50\u8BBE\u5B9A <small>${model.children(n.id).length}</small>${ib("\u6DFB\u52A0\u5B50\u8BBE\u5B9A", "new-child", "", "plus")}</h3>${childrenPreview(n)}</section></article>`;
    const people = model.links(n.id).map((r) => model.node(r.otherId)).filter((n2) => n2?.kind === "person");
    $("#main-foot").innerHTML = `<div class="related-stack">${people.map((n2) => `<span class="avatar">${esc(n2.title[0])}</span>`).join("")}<span>${people.map((n2) => esc(n2.title)).join("\u3001") || "\u8BA9\u6BCF\u9879\u8BBE\u5B9A\u90FD\u6709\u6765\u5904"}</span></div>${btn("\u7F16\u8F91\u6761\u76EE", "edit", "", n.id, "edit")}`;
  }
  function childrenPreview(n) {
    return model.children(n.id).map((c, i) => `<div class="child-preview"><span class="child-number">${String(i + 1).padStart(2, "0")}</span><button data-action="select" data-id="${c.id}"><strong>${esc(c.title)}</strong><p>${esc(c.body)}</p></button>${icon("chevron", 12)}</div>`).join("") || '<p class="tiny-label">\u6682\u65E0\u5B50\u8BBE\u5B9A</p>';
  }
  function emptyEntry() {
    return `<div class="empty"><h3>\u4ECE\u4E00\u9879\u8BBE\u5B9A\u5F00\u59CB</h3>\u7ED9\u8FD9\u4E2A\u4E16\u754C\u5199\u4E0B\u7B2C\u4E00\u4E2A\u7EC6\u8282\u3002${btn("\u65B0\u5EFA\u8BBE\u5B9A", "new-entry", "primary", "", "plus")}</div>`;
  }
  function renderC() {
    const n = model.node(model.selected);
    $("#detail-pane").innerHTML = `<button class="nav-rail detail-rail" data-action="toggle-detail" aria-label="\u5C55\u5F00\u6761\u76EE\u8BE6\u60C5">${icon("entry", 16)}<span>\u6761\u76EE\u8BE6\u60C5</span></button><header class="panel-title"><button class="back-button icon-button mobile-back" data-action="back-graph" aria-label="\u8FD4\u56DE\u5173\u7CFB\u56FE\u8C31">${icon("back", 14)}</button>${icon(n?.kind || "entry", 14)}<span>\u6761\u76EE\u8BE6\u60C5</span>${ib("\u6536\u8D77\u6761\u76EE\u8BE6\u60C5", "toggle-detail", "", "close")}</header><div class="panel-scroll" data-scroll="detail-${model.selected}">${n ? `<div class="tiny-label">${model.path(n.id).slice(0, -1).map((n2) => esc(n2.title)).join(" / ") || "\u5173\u8054\u4EBA\u7269"}</div><div class="fade-in">${entryBody(n)}</div><section class="reader-section"><h3 class="section-head">\u5173\u8054\u5173\u7CFB <small>${model.links(n.id).length}</small>${ib("\u6DFB\u52A0\u5173\u8054\u5173\u7CFB", "new-relation", "", "plus")}</h3>${relationRows(n.id)}</section><section class="reader-section"><h3 class="section-head">\u5B50\u8BBE\u5B9A <small>${model.children(n.id).length}</small></h3>${childrenPreview(n)}</section>` : emptyEntry()}</div><footer class="panel-foot">${btn("\u7F16\u8F91\u6761\u76EE", "edit", "primary", n?.id || "", "edit")}${ib("\u6761\u76EE\u66F4\u591A\u64CD\u4F5C", "entry-menu", n?.id || "")}</footer>`;
    $("#main-foot").innerHTML = `<div class="graph-legend"><span><i></i>\u8BBE\u5B9A\u5173\u7CFB</span><span>\u62D6\u52A8\u8282\u70B9\u7F16\u6392</span></div><div class="zoom-control"><button data-action="zoom-out" aria-label="\u7F29\u5C0F">\u2212</button><button data-action="zoom-reset" title="\u6062\u590D100%">${Math.round(prefs.pan.zoom * 100)}%</button><button data-action="zoom-in" aria-label="\u653E\u5927">+</button><i></i><button data-action="graph-home" title="\u56DE\u5230\u5F53\u524D\u6761\u76EE">${icon("expand", 13)} \u805A\u7126</button></div>`;
    renderGraph();
  }
  var graphPoints = [[167, 110], [658, 110], [690, 293], [658, 492], [166, 492], [132, 292]];
  function graphLayout() {
    const n = model.node(graphFocus);
    if (!n) return [];
    const neighbors = [...new Set(model.links(graphFocus).map((r) => r.otherId))];
    return [{ node: n, x: 412, y: 292, center: true }, ...neighbors.map((id, i) => ({ node: model.node(id), x: neighbors.length > 6 ? 412 + 300 * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / neighbors.length) : graphPoints[i % 6][0], y: neighbors.length > 6 ? 292 + 205 * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / neighbors.length) : graphPoints[i % 6][1] }))].filter((p) => p.node).map((p) => ({ ...p, ...prefs.positions[graphFocus + ":" + p.node.id] }));
  }
  function renderGraph() {
    if (V !== "C") return;
    const items = graphLayout(), at = new Map(items.map((i) => [i.node.id, i]));
    $("#graph-nodes").innerHTML = items.map((p) => `<button class="graph-node ${p.center ? "center" : ""} ${p.node.kind === "person" ? "person" : ""} ${model.selected === p.node.id ? "selected" : ""}" data-graph-node="${p.node.id}" aria-label="\u9009\u62E9${esc(p.node.title)}" style="left:${p.x}px;top:${p.y}px"><small>${icon(p.node.kind, 12)}${p.center ? "\u5F53\u524D\u4E2D\u5FC3" : esc(kinds[p.node.kind] || "\u8BBE\u5B9A")}</small><h3>${esc(p.node.title)}</h3>${p.center ? `<p class="node-summary">${esc((p.node.body || "").split("\u3002")[0].slice(0, 22))}\u3002</p>` : ""}</button>`).join("");
    $("#graph-edges").innerHTML = `<defs><marker id="arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 7 4 1 7" fill="none" stroke="#c4b6d1" stroke-width="1"/></marker></defs>` + model.links(graphFocus).map((r) => {
      const a = at.get(graphFocus), b = at.get(r.otherId);
      if (!a || !b) return "";
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, ax = a.x + ux * 82, ay = a.y + uy * 44, bx = b.x - ux * 65, by = b.y - uy * 34, mx = (ax + bx) / 2, my = (ay + by) / 2, w = Math.max(36, r.displayLabel.length * 11 + 18);
      return `<g data-graph-rel="${r.id}" data-other="${r.otherId}"><path class="graph-edge" d="M${ax} ${ay}C${ax + (bx - ax) * 0.55} ${ay},${bx - (bx - ax) * 0.55} ${by},${bx} ${by}" ${r.direction === "in" ? "marker-start" : "marker-end"}="url(#arrow)"/><rect class="edge-label-bg" x="${mx - w / 2}" y="${my - 11}" width="${w}" height="22" rx="11"/><text class="edge-label" x="${mx}" y="${my + 3.5}" text-anchor="middle">${esc(r.displayLabel)}</text></g>`;
    }).join("");
    applyGraphTransform();
  }
  function applyGraphTransform() {
    const p = prefs.pan;
    $("#graph-content")?.style.setProperty("transform", `translate(-50%,-50%) translate(${p.x}px,${p.y}px) scale(${p.zoom})`);
    const z = $(".zoom-control button:nth-child(2)");
    if (z) z.textContent = Math.round(p.zoom * 100) + "%";
  }
  function applyWidths() {
    const budget = innerWidth - 56 - (V === "A" ? 16 : 32) - 480, nav = prefs.navClosed ? 40 : Math.min(prefs.widths.nav, budget - (V === "A" ? 0 : V === "B" ? prefs.listClosed ? 40 : 240 : prefs.detailClosed ? 40 : 300)), side = V === "B" ? prefs.listClosed ? 40 : Math.min(prefs.widths.list, budget - nav) : V === "C" ? prefs.detailClosed ? 40 : Math.min(prefs.widths.detail, budget - nav) : 0;
    document.documentElement.style.setProperty("--nav-w", Math.max(40, nav) + "px");
    document.documentElement.style.setProperty(V === "B" ? "--list-w" : "--detail-w", Math.max(40, side) + "px");
    document.body.classList.toggle("nav-closed", prefs.navClosed && !isNarrow());
    document.body.classList.toggle("list-closed", prefs.listClosed && !isNarrow());
    document.body.classList.toggle("detail-closed", prefs.detailClosed && !isNarrow());
    for (const d of $$(".divider")) {
      const k = d.dataset.size;
      d.setAttribute("aria-valuenow", prefs.widths[k]);
      d.setAttribute("aria-valuemin", k === "nav" ? V === "C" ? 160 : 180 : k === "list" ? 240 : 300);
      d.setAttribute("aria-valuemax", k === "nav" ? 360 : k === "list" ? 400 : 460);
    }
  }
  function render() {
    if (V === "C" && !model.node(graphFocus)) {
      graphFocus = model.selected || model.data.nodes.find((n) => !n.isSet)?.id;
      prefs.pan = { x: 0, y: 0, zoom: 1 };
    }
    const focused = document.activeElement?.dataset.focusKey, sel = focused ? { a: document.activeElement.selectionStart, b: document.activeElement.selectionEnd } : null;
    rememberScroll();
    document.body.dataset.screen = screen;
    document.body.dataset.drawer = drawer || "";
    renderTop();
    renderMobile();
    renderNav();
    renderHead();
    if (V === "A") renderA();
    if (V === "B") renderB();
    if (V === "C") renderC();
    applyWidths();
    restoreScroll();
    syncDrawer();
    if (focused) {
      const el = $(`[data-focus-key="${focused}"]`);
      el?.focus({ preventScroll: true });
      if (sel) el?.setSelectionRange(sel.a, sel.b);
    }
  }
  function syncDrawer() {
    const opened = isNarrow() && drawer === "nav", nav = $("#nav-pane");
    nav.setAttribute("role", opened ? "dialog" : "navigation");
    if (opened) nav.setAttribute("aria-modal", "true");
    else nav.removeAttribute("aria-modal");
    for (const el of [...$$(".main-pane,.list-pane,.detail-pane"), $("#topbar"), $("#mobile-bar")]) if (el) el.inert = opened;
    if (opened && previousDrawer !== "nav") requestAnimationFrame(() => nav.querySelector(".nav-head button")?.focus({ preventScroll: true }));
    if (!opened && previousDrawer === "nav") requestAnimationFrame(() => $("#mobile-bar [data-action=open-nav]")?.focus({ preventScroll: true }));
    previousDrawer = opened ? "nav" : null;
  }
  function showDialog(title, body, actions = "") {
    commitDraft();
    const d = $("#dialog");
    if (d.open) d.close();
    d.innerHTML = `<form id="dialog-form"><header class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>${ib("\u5173\u95ED\u5F39\u7A97", "close-dialog", "", "close")}</header>${body}<p class="form-error" aria-live="polite"></p>${actions ? `<footer class="dialog-actions">${btn("\u53D6\u6D88", "close-dialog")}${actions}</footer>` : ""}</form>`;
    d.showModal();
    requestAnimationFrame(() => d.querySelector("[autofocus]")?.focus());
  }
  function openNew(parentId = null) {
    const parent = parentId || model.setId;
    showDialog(parentId ? "\u65B0\u5EFA\u5B50\u8BBE\u5B9A" : "\u65B0\u5EFA\u8BBE\u5B9A", `<label>\u6240\u5728\u4F4D\u7F6E<select name="parent">${model.data.nodes.filter((n) => n.isSet || n.id === parent).map((n) => `<option value="${n.id}" ${n.id === parent ? "selected" : ""}>${esc(n.title)}</option>`).join("")}</select></label><label>\u6761\u76EE\u540D\u79F0<input name="title" required maxlength="120" placeholder="\u7ED9\u8FD9\u9879\u8BBE\u5B9A\u4E00\u4E2A\u540D\u5B57" autofocus></label><label>\u8BBE\u5B9A\u5185\u5BB9<textarea name="body" placeholder="\u5199\u4E0B\u5B83\u5728\u6545\u4E8B\u4E2D\u7684\u6837\u5B50\u2026"></textarea></label><label>\u6807\u7B7E<input name="tags" placeholder="\u5730\u70B9\uFF0C\u5173\u952E\u7EBF\u7D22"></label>`, `<button type="submit" class="btn primary">${icon("plus", 14)} \u521B\u5EFA\u6761\u76EE</button>`);
    $("#dialog-form").dataset.form = "new";
  }
  function openRelation() {
    const id = model.selected;
    if (!model.node(id)) return toast("\u5148\u9009\u62E9\u4E00\u4E2A\u8BBE\u5B9A\u6761\u76EE");
    showDialog("\u5EFA\u7ACB\u4E16\u754C\u5173\u7CFB", `<div class="context-line">\u4ECE\u300C${esc(model.node(id).title)}\u300D\u51FA\u53D1</div><label>\u641C\u7D22\u5173\u8054\u5BF9\u8C61<input id="relation-search" placeholder="\u8BBE\u5B9A\u6216\u4EBA\u7269\u540D\u79F0" autocomplete="off" autofocus></label><label>\u5173\u8054\u5BF9\u8C61<select name="target" required id="relation-target">${targetOptions("")}</select></label><label>\u5173\u7CFB\u540D\u79F0<input name="label" required placeholder="\u4F8B\u5982\uFF1A\u9075\u5FAA\u3001\u7EF4\u62A4\u3001\u9A7B\u5B88"></label><div class="dialog-options">${["\u5173\u8054", "\u4F4D\u4E8E", "\u9075\u5FAA", "\u7EF4\u62A4", "\u6210\u5458"].map((s) => `<button type="button" data-action="preset" data-value="${s}">${s}</button>`).join("")}</div><label>\u53CD\u5411\u540D\u79F0\uFF08\u53EF\u9009\uFF09<input name="reverse" placeholder="\u5BF9\u65B9\u770B\u5411\u6B64\u6761\u76EE\u65F6\u7684\u5173\u7CFB"></label>`, `<button type="submit" class="btn primary">${icon("link", 14)} \u6DFB\u52A0\u5173\u7CFB</button>`);
    $("#dialog-form").dataset.form = "relation";
    $("#dialog-form").dataset.source = id;
  }
  function targetOptions(q) {
    return model.search(q).filter((n) => n.id !== model.selected).map((n) => `<option value="${n.id}">${esc(n.title)} \xB7 ${esc(kinds[n.kind] || "\u8BBE\u5B9A")}</option>`).join("");
  }
  function openSearch() {
    showDialog("\u67E5\u627E\u4E16\u754C\u4E2D\u7684\u7EC6\u8282", `<label style="margin-top:0"><input id="global-search" type="search" placeholder="\u641C\u7D22\u8BBE\u5B9A\u3001\u6B63\u6587\u6216\u6807\u7B7E\u2026" aria-label="\u5168\u5C40\u641C\u7D22" autocomplete="off" autofocus></label><div class="search-results" id="search-results"></div>`);
    renderSearch("");
  }
  function renderSearch(q) {
    $("#search-results").innerHTML = model.search(q).slice(0, 20).map((n) => `<button type="button" class="search-result" data-action="search-pick" data-id="${n.id}"><strong>${esc(n.title)}</strong><small>${model.path(n.id).slice(0, -1).map((n2) => esc(n2.title)).join(" / ") || "\u5173\u8054\u4EBA\u7269"}</small></button>`).join("") || '<div class="empty">\u6CA1\u6709\u627E\u5230\u5339\u914D\u5185\u5BB9\uFF0C\u8BD5\u8BD5\u5176\u4ED6\u5173\u952E\u8BCD\u3002</div>';
  }
  function startEdit(id, body = false) {
    if ($("#dialog").open) $("#dialog").close();
    commitDraft();
    const n = model.node(id);
    if (!n) return;
    editing = { id, title: n.title, body: n.body || "" };
    render();
    requestAnimationFrame(() => $(`[data-edit="${body ? "body" : "title"}"]`)?.focus());
  }
  function startResize(el, e) {
    if (isNarrow() || e.button !== 0) return;
    e.preventDefault();
    const key = el.dataset.size, start = e.clientX, initial = prefs.widths[key], min = key === "nav" ? V === "C" ? 160 : 180 : key === "list" ? 240 : 300, max = key === "nav" ? 360 : key === "list" ? 400 : 460, sign = key === "detail" ? -1 : 1;
    el.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    const move = (ev) => {
      prefs.widths[key] = Math.round(Math.max(min, Math.min(max, initial + (ev.clientX - start) * sign)));
      applyWidths();
    }, up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      persist();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  function act(action, id, el) {
    if (!["save-edit", "cancel-edit", "close-dialog", "preset"].includes(action)) commitDraft();
    switch (action) {
      case "module":
        break;
      case "search":
        openSearch();
        break;
      case "search-pick":
        $("#dialog").close();
        selectNode(id);
        break;
      case "settings":
        showDialog("\u5DE5\u4F5C\u533A", `<div class="settings-options">${btn("\u67E5\u627E\u8BBE\u5B9A", "search", "", "", "search")}${btn("\u64A4\u9500\u4E0A\u4E00\u6B65", "undo", "", "", "undo")}${btn("\u91CD\u505A\u4E0A\u4E00\u6B65", "redo", "", "", "redo")}${btn("\u6062\u590D\u672C\u65B9\u6848\u521D\u59CB\u5185\u5BB9", "reset-confirm", "", "", "back")}<a class="btn" href="style-explorer.html">\u8FD4\u56DE\u4E09\u7248\u5BF9\u6BD4</a></div>`);
        break;
      case "close-dialog":
        $("#dialog").close();
        break;
      case "reset-confirm":
        $("#dialog").close();
        showDialog("\u6062\u590D\u521D\u59CB\u5185\u5BB9", `<p>\u5C06\u6062\u590D\u672C\u65B9\u6848\u7684\u8BBE\u5B9A\u5185\u5BB9\u3001\u5173\u7CFB\u548C\u5E03\u5C40\u3002\u5176\u4ED6\u4E24\u4E2A\u65B9\u6848\u4E0D\u53D7\u5F71\u54CD\u3002</p>`, btn("\u786E\u8BA4\u6062\u590D", "reset", "primary"));
        break;
      case "reset":
        if (sessionOnly) {
          model.restore({ data: content_default, selected: "lighthouse", setId: "geography" });
          model.history = [];
          model.future = [];
          prefs = { widths: { ...defaults }, navClosed: false, listClosed: false, detailClosed: false, folded: [], positions: {}, pan: { x: 0, y: 0, zoom: 1 } };
          query = "";
          tag = "";
          graphFocus = "lighthouse";
          editing = null;
          inlineDraft = null;
          relatedOpen = false;
          drawer = null;
          backStack = [];
          scrolls.clear();
          $("#dialog").close();
          render();
          break;
        }
        resetting = true;
        clearTimeout(saveTimer);
        localStorage.removeItem(KEY);
        location.reload();
        break;
      case "toggle-nav":
        if (isNarrow()) drawer = null;
        else prefs.navClosed = !prefs.navClosed;
        persist();
        render();
        break;
      case "open-nav":
        if (isNarrow()) drawer = "nav";
        else prefs.navClosed = false;
        render();
        break;
      case "close-drawer":
        drawer = null;
        render();
        break;
      case "toggle-list":
        prefs.listClosed = !prefs.listClosed;
        persist();
        render();
        break;
      case "toggle-detail":
        if (isNarrow()) screen = "graph";
        else prefs.detailClosed = !prefs.detailClosed;
        persist();
        render();
        break;
      case "category":
        setCategory(id);
        break;
      case "select":
        selectNode(id);
        break;
      case "back-entry": {
        const prev = backStack.pop();
        if (prev) selectNode(prev, { remember: false });
        break;
      }
      case "back-list":
        screen = "list";
        render();
        break;
      case "back-graph":
        screen = "graph";
        render();
        break;
      case "tag":
        tag = tag === el.dataset.tag ? "" : el.dataset.tag;
        if (V === "B" && isNarrow()) screen = "list";
        render();
        break;
      case "clear":
        query = "";
        tag = "";
        render();
        break;
      case "new-entry":
        if ($("#dialog").open) $("#dialog").close();
        openNew();
        break;
      case "new-child":
        if ($("#dialog").open) $("#dialog").close();
        openNew(model.selected);
        break;
      case "edit":
        startEdit(id || model.selected);
        break;
      case "edit-body":
        startEdit(id || model.selected, true);
        break;
      case "save-edit":
        commitDraft(true);
        toast("\u4FEE\u6539\u5DF2\u4FDD\u5B58");
        break;
      case "cancel-edit":
        editing = null;
        render();
        break;
      case "related":
        relatedOpen = !relatedOpen;
        render();
        break;
      case "fold":
        if (prefs.folded.includes(id)) prefs.folded = prefs.folded.filter((x) => x !== id);
        else prefs.folded.push(id);
        persist();
        render();
        break;
      case "undo":
        if (model.undo()) {
          if (V === "C") {
            graphFocus = model.selected;
            prefs.pan = { x: 0, y: 0, zoom: 1 };
          }
          if ($("#dialog").open) $("#dialog").close();
          persist();
          render();
          toast("\u5DF2\u64A4\u9500");
        }
        break;
      case "redo":
        if (model.redo()) {
          if (V === "C") {
            graphFocus = model.selected;
            prefs.pan = { x: 0, y: 0, zoom: 1 };
          }
          if ($("#dialog").open) $("#dialog").close();
          persist();
          render();
          toast("\u5DF2\u91CD\u505A");
        }
        break;
      case "entry-menu": {
        const n = model.node(id || model.selected);
        if (!n) break;
        showDialog(n.title, `<div class="settings-options">${btn("\u7F16\u8F91\u6761\u76EE", "edit", "", n.id, "edit")}${btn("\u6DFB\u52A0\u5B50\u8BBE\u5B9A", "new-child", "", "", "plus")}${btn("\u5EFA\u7ACB\u5173\u7CFB", "new-relation", "", "", "link")}${btn("\u5220\u9664\u6761\u76EE", "delete-confirm", "danger", n.id, "trash")}</div>`);
        break;
      }
      case "delete-confirm": {
        const n = model.node(id);
        $("#dialog").close();
        showDialog("\u5220\u9664\u8FD9\u9879\u8BBE\u5B9A\uFF1F", `<p>\u300C${esc(n.title)}\u300D\u53CA ${model.descendants(id).length} \u9879\u5B50\u8BBE\u5B9A\u5C06\u4E00\u5E76\u79FB\u9664\uFF0C\u76F8\u5173\u8FDE\u7EBF\u4E5F\u4F1A\u6E05\u9664\u3002\u5220\u9664\u540E\u53EF\u64A4\u9500\u3002</p>`, btn("\u5220\u9664\u6761\u76EE", "delete", "danger", id));
        break;
      }
      case "delete":
        model.remove(id);
        $("#dialog").close();
        persist();
        render();
        toast("\u6761\u76EE\u5DF2\u79FB\u9664", true);
        break;
      case "new-relation":
        if ($("#dialog").open) $("#dialog").close();
        openRelation();
        break;
      case "remove-relation":
        model.removeRelation(id);
        persist();
        render();
        toast("\u5173\u7CFB\u5DF2\u79FB\u9664", true);
        break;
      case "preset":
        $("#dialog-form [name=label]").value = el.dataset.value;
        break;
      case "zoom-in":
        prefs.pan.zoom = Math.min(1.6, prefs.pan.zoom + 0.1);
        applyGraphTransform();
        persist();
        break;
      case "zoom-out":
        prefs.pan.zoom = Math.max(0.5, prefs.pan.zoom - 0.1);
        applyGraphTransform();
        persist();
        break;
      case "zoom-reset":
        prefs.pan.zoom = 1;
        applyGraphTransform();
        persist();
        break;
      case "graph-home":
        graphFocus = model.selected || graphFocus;
        prefs.pan = { x: 0, y: 0, zoom: 1 };
        persist();
        render();
        break;
      case "graph-settings":
        showDialog("\u56FE\u8C31\u89C6\u56FE", `<div class="settings-options">${btn("\u805A\u7126\u5F53\u524D\u6761\u76EE", "graph-focus", "", "", "expand")}${btn("\u6062\u590D\u8282\u70B9\u7F16\u6392", "reset-positions", "", "", "tidy")}${btn("\u67E5\u627E\u5176\u4ED6\u8BBE\u5B9A", "search", "", "", "search")}</div>`);
        break;
      case "graph-focus":
        $("#dialog").close();
        graphFocus = model.selected;
        prefs.pan = { x: 0, y: 0, zoom: 1 };
        persist();
        render();
        break;
      case "reset-positions":
        $("#dialog").close();
        prefs.positions = {};
        prefs.pan = { x: 0, y: 0, zoom: 1 };
        persist();
        render();
        break;
    }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.closest(".graph-node")) return;
    e.preventDefault();
    act(b.dataset.action, b.dataset.id, b);
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-edit]") && editing) {
      editing[t.dataset.edit] = t.value;
      updateSave();
    } else if (t.id === "nav-search") {
      query = t.value;
      render();
    } else if (t.id === "global-search") renderSearch(t.value);
    else if (t.id === "relation-search") $("#relation-target").innerHTML = targetOptions(t.value);
    else if (t.matches("[data-inline]")) {
      inlineDraft = { id: t.dataset.inline, value: t.textContent };
      updateSave();
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "tag-filter") {
      tag = e.target.value;
      render();
    }
  });
  document.addEventListener("focusout", (e) => {
    if (e.target.matches("[data-inline]")) {
      commitDraft();
      persist();
    }
  });
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.id === "edit-form") {
      commitDraft(true);
      return;
    }
    if (form.id !== "dialog-form") return;
    const data = new FormData(form);
    if (form.dataset.form === "new") {
      const n = model.add(data.get("parent"), { title: String(data.get("title")).trim(), body: String(data.get("body")), tags: String(data.get("tags")).split(/[,，]/).map((t) => t.trim()).filter(Boolean), kind: model.node(data.get("parent"))?.kind || "entry" });
      if (n) {
        $("#dialog").close();
        selectNode(n.id);
        toast("\u65B0\u8BBE\u5B9A\u5DF2\u52A0\u5165\u5F53\u524D\u8BBE\u5B9A\u96C6");
      }
    } else if (form.dataset.form === "relation") {
      const r = model.addRelation(form.dataset.source, data.get("target"), String(data.get("label")), String(data.get("reverse")));
      if (!r) {
        $(".form-error").textContent = "\u8BF7\u9009\u62E9\u4E0D\u540C\u7684\u5BF9\u8C61\uFF0C\u5E76\u586B\u5199\u672A\u91CD\u590D\u7684\u5173\u7CFB\u3002";
        return;
      }
      $("#dialog").close();
      persist();
      render();
      toast("\u5173\u7CFB\u5DF2\u5EFA\u7ACB");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && drawer === "nav" && !$("#dialog").open) {
      const controls = [...$("#nav-pane").querySelectorAll("button,input,select")].filter((el) => !el.disabled && el.getClientRects().length), first = controls[0], last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
        e.preventDefault();
        first?.focus();
      }
    }
    if (e.key === "Escape") {
      if ($("#dialog").open) return;
      if (editing) {
        e.preventDefault();
        editing = null;
        render();
        return;
      }
      if (inlineDraft) {
        e.preventDefault();
        inlineDraft = null;
        render();
        return;
      }
      if (drawer) {
        drawer = null;
        render();
        return;
      }
      if (relatedOpen) {
        relatedOpen = false;
        render();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && editing) {
      e.preventDefault();
      commitDraft(true);
      return;
    }
    const graphNode = e.target.closest("[data-graph-node]");
    if (graphNode && ["Enter", " "].includes(e.key)) {
      e.preventDefault();
      selectNode(graphNode.dataset.graphNode);
      return;
    }
    const inline = e.target.closest("[data-inline]");
    if (inline) {
      const id = inline.dataset.inline;
      if (e.key === "Tab") {
        e.preventDefault();
        commitDraft();
        const moved = e.shiftKey ? model.outdent(id) : model.indent(id);
        if (!moved) toast("\u8BE5\u6761\u76EE\u5DF2\u5728\u5F53\u524D\u53EF\u8C03\u6574\u7684\u5C42\u7EA7");
        persist();
        render();
        requestAnimationFrame(() => {
          let target = $(`[data-inline="${id}"]`);
          if (!target) {
            selectNode(id);
            target = $(`[data-inline="${id}"]`);
          }
          target?.focus();
        });
      }
      if (e.key === "Enter") {
        e.preventDefault();
        commitDraft();
        const n = model.node(id), previous = model.selected, row = model.add(n.parentId, { title: "\u65B0\u8BBE\u5B9A", kind: "entry" }, id);
        if (!model.node(n.parentId)?.isSet) model.selected = previous;
        persist();
        render();
        requestAnimationFrame(() => {
          const target = $(`[data-inline="${row.id}"]`);
          if (target) {
            target.focus();
            const r = document.createRange();
            r.selectNodeContents(target);
            const s = getSelection();
            s.removeAllRanges();
            s.addRange(r);
          } else selectNode(row.id);
        });
      }
    }
    const d = e.target.closest(".divider");
    if (d && ["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
      e.preventDefault();
      const k = d.dataset.size, sign = k === "detail" ? -1 : 1;
      if (e.key === "Home") prefs.widths[k] = defaults[k];
      else prefs.widths[k] = Math.max(k === "nav" ? 160 : k === "list" ? 240 : 300, Math.min(k === "nav" ? 360 : k === "list" ? 400 : 460, prefs.widths[k] + (e.key === "ArrowRight" ? 1 : -1) * sign * (e.shiftKey ? 40 : 10)));
      applyWidths();
      persist();
    }
  });
  for (const d of $$(".divider")) {
    d.addEventListener("pointerdown", (e) => startResize(d, e));
    d.addEventListener("dblclick", (e) => {
      e.preventDefault();
      prefs.widths[d.dataset.size] = defaults[d.dataset.size];
      applyWidths();
      persist();
    });
  }
  var dragId = null;
  document.addEventListener("dragstart", (e) => {
    const h = e.target.closest("[data-drag]");
    if (!h) return;
    commitDraft();
    dragId = h.dataset.drag;
    e.dataTransfer.setData("text/plain", dragId);
    e.dataTransfer.effectAllowed = "move";
    h.closest("[data-row]").classList.add("dragging");
  });
  document.addEventListener("dragover", (e) => {
    const row = e.target.closest("[data-row]");
    if (!row || !dragId) return;
    e.preventDefault();
    $$(".drop-before,.drop-inside").forEach((el) => el.classList.remove("drop-before", "drop-inside"));
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height * 0.3 ? "drop-before" : "drop-inside");
  });
  document.addEventListener("drop", (e) => {
    const row = e.target.closest("[data-row]");
    if (!row || !dragId) return;
    e.preventDefault();
    const target = model.node(row.dataset.row), before = row.classList.contains("drop-before"), ok = model.move(dragId, before ? target.parentId : target.id, before ? target.id : null);
    if (!ok) toast("\u4E0D\u80FD\u5C06\u6761\u76EE\u653E\u5165\u81EA\u8EAB\u6216\u5176\u5B50\u5C42\u7EA7");
    dragId = null;
    persist();
    render();
  });
  document.addEventListener("dragend", () => {
    dragId = null;
    $$(".dragging,.drop-before,.drop-inside").forEach((el) => el.classList.remove("dragging", "drop-before", "drop-inside"));
  });
  var gesture = null;
  if (V === "C") {
    const stage = $("#graph-stage");
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      commitDraft();
      const el = e.target.closest("[data-graph-node]");
      gesture = { id: el?.dataset.graphNode, x: e.clientX, y: e.clientY, start: { ...prefs.pan }, point: el ? graphLayout().find((p) => p.node.id === el.dataset.graphNode) : null, moved: false };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stage.addEventListener("pointermove", (e) => {
      if (!gesture) return;
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) gesture.moved = true;
      if (!gesture.moved) return;
      if (gesture.id) {
        prefs.positions[graphFocus + ":" + gesture.id] = { x: gesture.point.x + dx / prefs.pan.zoom, y: gesture.point.y + dy / prefs.pan.zoom };
        renderGraph();
      } else {
        prefs.pan.x = gesture.start.x + dx;
        prefs.pan.y = gesture.start.y + dy;
        applyGraphTransform();
      }
    });
    stage.addEventListener("pointerup", () => {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      if (g.id && !g.moved) selectNode(g.id);
      persist();
    });
    stage.addEventListener("pointercancel", () => {
      gesture = null;
      persist();
    });
    stage.addEventListener("dblclick", (e) => {
      const n = e.target.closest("[data-graph-node]");
      if (n) {
        graphFocus = n.dataset.graphNode;
        prefs.pan = { x: 0, y: 0, zoom: 1 };
        selectNode(n.dataset.graphNode, { focus: true });
      }
    });
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      prefs.pan.zoom = Math.max(0.5, Math.min(1.6, prefs.pan.zoom - e.deltaY * 1e-3));
      applyGraphTransform();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 150);
    }, { passive: false });
    document.addEventListener("pointerover", (e) => {
      const row = e.target.closest("[data-rel]"), node = e.target.closest("[data-graph-node]");
      if (!row && !node) return;
      const rid = row?.dataset.rel, id = node?.dataset.graphNode;
      $$("[data-graph-rel]").forEach((el) => {
        const on = rid ? el.dataset.graphRel === rid : el.dataset.other === id;
        el.querySelector(".graph-edge")?.classList.toggle("active", on);
      });
      $$("[data-rel]").forEach((el) => el.classList.toggle("hover", rid ? el.dataset.rel === rid : el.dataset.related === id));
      $$(".graph-node").forEach((el) => el.classList.toggle("hover", row?.dataset.related === el.dataset.graphNode));
    });
    document.addEventListener("pointerout", (e) => {
      if (e.relatedTarget?.closest?.("[data-rel],[data-graph-node]")) return;
      $$(".graph-edge.active,.rel-row.hover,.graph-node.hover").forEach((el) => el.classList.remove("active", "hover"));
    });
  }
  var resetting = false;
  var narrowBefore = isNarrow();
  window.addEventListener("resize", () => {
    const narrow = isNarrow();
    if (narrow !== narrowBefore) {
      drawer = null;
      narrowBefore = narrow;
      render();
    } else applyWidths();
  });
  window.addEventListener("pagehide", () => {
    if (!resetting) {
      commitDraft();
      persist();
    }
  });
  $("#dialog").addEventListener("click", (e) => {
    if (e.target === $("#dialog")) {
      const r = e.target.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
  });
  render();
  window.__lorePrototype = { model, get prefs() {
    return prefs;
  }, get editing() {
    return editing;
  }, get key() {
    return KEY;
  }, select: selectNode, render, get query() {
    return query;
  }, get graphFocus() {
    return graphFocus;
  } };
  window.__loreReady = true;
})();
