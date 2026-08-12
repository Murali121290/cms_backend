<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet 
    version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xlink="http://www.w3.org/1999/xlink">

    <xsl:output method="html" indent="yes" encoding="UTF-8"/>

    <!-- ROOT -->
<xsl:template match="/book">
    <html>
        <head>
            <meta charset="UTF-8"/>
            <title>
                <xsl:apply-templates select="book-body/book-part/book-part-meta/title-group/title/node()"/>
            </title>
            <link rel="stylesheet" type="text/css" href="style.css"/>
        </head>
        <body>
            <div class="container">

                <!-- FIX: support XML with or without <book-part book-part-type='part'> -->
                <xsl:choose>
                    <xsl:when test="book-body/book-part[@book-part-type='part']">
                        <xsl:apply-templates select="book-body/book-part[@book-part-type='part']"/>
                    </xsl:when>
                    <xsl:otherwise>
                        <xsl:apply-templates select="book-body/book-part[@book-part-type='chapter']"/>
                    </xsl:otherwise>
                </xsl:choose>

            </div>
        </body>
    </html>
</xsl:template>


    <!-- UNIT -->
    <xsl:template match="book-part[@book-part-type='part']">
        <div class="unit-header">
            <h1 class="unit-label"><xsl:value-of select="book-part-meta/title-group/label"/></h1>
            <h2 class="unit-title"><xsl:apply-templates select="book-part-meta/title-group/title/node()"/></h2>
        </div>

        <xsl:apply-templates select="body/book-part[@book-part-type='chapter']"/>
        <xsl:apply-templates select="back/ref-list"/>
    </xsl:template>

    <!-- CHAPTER -->
    <xsl:template match="book-part[@book-part-type='chapter']">

        <div class="chapter-header">
            <h2 class="chapter-number">
                <xsl:value-of select="book-part-meta/title-group/label"/>
            </h2>

            <h1 class="chapter-title">
                <xsl:apply-templates select="book-part-meta/title-group/title/node()"/>
            </h1>

            <h3 class="chapter-authors">
                    <xsl:for-each select="book-part-meta/contrib-group/contrib">
                    <xsl:value-of select="name/surname"/>
                    <xsl:text> </xsl:text>
                    <xsl:value-of select="name/given-names"/>
                    <xsl:if test="position()!=last()">, </xsl:if>
                </xsl:for-each>
            </h3>
        </div>

        <xsl:apply-templates select="book-part-meta/abstract"/>
        <xsl:apply-templates select="book-part-meta/kwd-group"/>

        <div class="chapter-body">
            <xsl:apply-templates select="body/*"/>
        </div>

        <xsl:apply-templates select="back/ref-list"/>
    </xsl:template>

    <!-- ABSTRACT -->
    <xsl:template match="abstract">
        <section class="abstract">
		<div class="abstract-title"><xsl:apply-templates select="title/node()"/></div>
           <xsl:apply-templates select="p"/>
        </section>
    </xsl:template>

    <!-- KEYWORDS -->
    <xsl:template match="kwd-group">
        <section class="keywords">
            <div class="keyword-title"><xsl:apply-templates select="title/node()"/></div>
            <ul class="kwd-list">
                <xsl:for-each select="kwd">
                    <li><xsl:value-of select="."/></li>
                </xsl:for-each>
            </ul>
        </section>
    </xsl:template>

    <!-- EPIGRAPH -->
    <xsl:template match="disp-quote">
        <blockquote class="epigraph">
            <xsl:apply-templates select="p"/>
            <xsl:apply-templates select="attrib"/>
        </blockquote>
    </xsl:template>

    <xsl:template match="attrib">
        <cite class="epigraph-attrib"><xsl:apply-templates/></cite>
    </xsl:template>

    <!-- SECTIONS -->
    <xsl:template match="sec">
        <section class="sec">
            <h2 class="section-heading">
                <xsl:apply-templates select="title/node()"/>
            </h2>
            <xsl:apply-templates select="p | list | sec | boxed-text | table-wrap | fig | disp-quote | ref-list | *"/>
        </section>
    </xsl:template>

    <xsl:template match="sec/sec">
        <section class="subsec">
            <h3 class="subsection-heading"><xsl:apply-templates select="title/node()"/></h3>
            <xsl:apply-templates/>
        </section>
    </xsl:template>

    <!-- PARAGRAPHS -->
    <xsl:template match="p">
        <p><xsl:apply-templates/></p>
    </xsl:template>

    <!-- LISTS -->
    <xsl:template match="list">
        <xsl:choose>
            <xsl:when test="@list-type='order'">
                <ol class="item-list">
                    <xsl:for-each select="list-item">
                        <li><xsl:apply-templates/></li>
                    </xsl:for-each>
                </ol>
            </xsl:when>
            <xsl:otherwise>
                <ul class="item-list">
                    <xsl:for-each select="list-item">
                        <li><xsl:apply-templates/></li>
                    </xsl:for-each>
                </ul>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <!-- BOXED TEXT -->
    <xsl:template match="boxed-text">
        <div class="boxed-text">
            <xsl:if test="label">
                <div class="boxed-label">
                    <xsl:apply-templates select="label/node()"/>
                </div>
            </xsl:if>
            <xsl:if test="caption/title">
                <div class="boxed-caption">
                    <strong><xsl:apply-templates select="caption/title/node()"/></strong>
                </div>
            </xsl:if>
            <xsl:apply-templates select="*[not(self::label or self::caption)]"/>
        </div>
    </xsl:template>

    <!-- TABLE WRAP -->
    <xsl:template match="table-wrap">
        <div class="table-wrap">

            <xsl:if test="label">
                <div class="table-label"><xsl:value-of select="label"/></div>
            </xsl:if>

            <xsl:if test="caption/title">
                <div class="table-caption">
                    <strong><xsl:apply-templates select="caption/title/node()"/></strong>
                </div>
            </xsl:if>

            <xsl:apply-templates select="table"/>
        </div>
    </xsl:template>

    <!-- TABLE -->
    <xsl:template match="table">
        <table class="exhibit-table"><xsl:apply-templates/></table>
    </xsl:template>

    <xsl:template match="tbody"><tbody><xsl:apply-templates/></tbody></xsl:template>
    <xsl:template match="tr"><tr><xsl:apply-templates/></tr></xsl:template>

    <xsl:template match="td">
        <td valign="{@valign}" align="{@align}"><xsl:apply-templates/></td>
    </xsl:template>

    <!-- FIGURE SUPPORT -->
    <xsl:template match="fig">
        <div class="figure-box" id="{@id}">

            <xsl:if test="label">
                <div class="figure-label"><xsl:value-of select="label"/></div>
            </xsl:if>

            <xsl:if test="caption">
                <div class="figure-caption">
                    <xsl:apply-templates select="caption"/>
                </div>
            </xsl:if>

            <!-- Render image if present -->
            <xsl:apply-templates select="graphic | media | img"/>
        </div>
    </xsl:template>

    <xsl:template match="caption">
        <div class="figure-caption-text">
            <xsl:apply-templates/>
        </div>
    </xsl:template>

    <xsl:template match="graphic">
        <img class="figure-image" src="{@xlink:href}" alt="Figure"/>
    </xsl:template>

    <!-- INLINE FORMATTING -->
    <xsl:template match="italic"><em><xsl:apply-templates/></em></xsl:template>
    <xsl:template match="bold"><strong><xsl:apply-templates/></strong></xsl:template>
    <xsl:template match="sup"><sup><xsl:apply-templates/></sup></xsl:template>

    <xsl:template match="xref">
        <a href="#{@rid}" class="xref"><xsl:apply-templates/></a>
    </xsl:template>

    <!-- REFERENCES -->
    <xsl:template match="ref-list">
        <section class="references">
            <h2 class="section-heading"></h2>
            <ol class="ref-list"><xsl:apply-templates select="ref"/></ol>
        </section>
    </xsl:template>

    <xsl:template match="ref">
        <li class="ref-item"><xsl:apply-templates/></li>
    </xsl:template>

    <xsl:template match="mixed-citation">
        <span class="citation"><xsl:apply-templates/></span>
    </xsl:template>

    <xsl:template match="person-group">
        <xsl:for-each select="string-name">
            <xsl:apply-templates select="."/>
            <xsl:if test="position()!=last()">, </xsl:if>
        </xsl:for-each>
    </xsl:template>

    <xsl:template match="string-name">
        <span class="author"><xsl:value-of select="surname"/>, <xsl:value-of select="given-names"/></span>
    </xsl:template>

    <xsl:template match="article-title | chapter-title">
        <span class="title"><strong><xsl:apply-templates/></strong></span>
    </xsl:template>

    <xsl:template match="source">
        <span class="source"><em><xsl:apply-templates/></em></span>
    </xsl:template>

    <xsl:template match="ext-link">
        <a href="{@xlink:href}" target="_blank"><xsl:apply-templates/></a>
    </xsl:template>

    <!-- Hide elements already handled manually in other templates to prevent text duplication -->
    <xsl:template match="title"/>
    <xsl:template match="label"/>

    <!-- Ignore highlight and query elements in transformed layout html -->
    <xsl:template match="highlight"><xsl:apply-templates/></xsl:template>
    <xsl:template match="query"/>

    <!-- FALLBACK -->
    <xsl:template match="text()"><xsl:value-of select="."/></xsl:template>

</xsl:stylesheet>
